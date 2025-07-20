import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { config } from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { challengeQueue, initializeChallengesQueue, initializeQueue } from './lib/queue';
import connectRoutes from './routes/connect';
import tweetRoutes from './routes/tweet';
import dashboardRoutes from './routes/dashboard';
import challengeRoutes from './routes/challenges';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { tweetQueue } from './lib/queue';
import { getGithubMetrics } from './services/github';
import { generateTweetContent } from './services/scheduler';
import { getLeetCodeMetrics } from './services/leetcode';
import { postTweet } from './services/twitter';
import { sendChallengeFailureEmail, sendMarketingEmail, sendWelcomeSeriesEmail } from './services/email';
import { supabase } from './lib/supabase';

config();

const app = express();
const port = process.env.PORT || 3003;

// Middleware
app.use(helmet());
app.use(
		cors({
			origin: ['https://devshare.ayanmn18.live', 'http://localhost:5173'], // Allow frontend urls
			credentials: true, // Required for cookies/auth headers
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization'],
		})
	);
app.use(express.json());
app.use(morgan('dev'));

// Rate limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000 // limit each IP to 100 requests per windowMs
// });
// app.use(limiter);

// Routes
app.use('/api/v1/connect', connectRoutes);
app.use('/api/v1/tweet', tweetRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/challenges', challengeRoutes); // Add challenge routes

// Error handling
app.use(errorHandler);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
  queues: [new BullMQAdapter(tweetQueue), new BullMQAdapter(challengeQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
app.post('/test-ai-tweet', async (req, res) => {
  try {
    const { ghUsername, lcUsername } = req.body;

    if (!ghUsername || !lcUsername) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'GitHub and LeetCode usernames are required',
        data: null,
      });
    }
    
    // Fetch GitHub metrics
    const githubMetrics = await getGithubMetrics(ghUsername, false);
    const leetCodeMetrics = await getLeetCodeMetrics(lcUsername);

    // Create a test tweet
    const tweetContent = await generateTweetContent(githubMetrics, leetCodeMetrics);

    res.json({
      status: 'SUCCESS',
      message: 'Test tweet generated successfully',
      data: {
        tweetContent
      }
    });
  } catch (error) {
    console.error('Error generating test tweet:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to generate test tweet',
      data: null
    });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// get leetcode metrics
app.post('/generateContent', async (req, res) => {
  const { lcUsername, ghUsername } = req.body;
  try {
    const lcMetrics = await getLeetCodeMetrics(lcUsername); 
    const ghMetrics = await getGithubMetrics(ghUsername, false);
    
    const content = await generateTweetContent(ghMetrics, lcMetrics);

    res.status(200).json({
      status: 'SUCCESS',
      message: 'LeetCode metrics fetched successfully',
      data: {
        leetCodeMetrics: lcMetrics,
        githubMetrics: ghMetrics,
        content
      }
    });
  } catch (error) {
    console.error('Error fetching LeetCode metrics:', error); 
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to fetch LeetCode metrics',
      data: null
    });
  }
});

// create an api whihc takes in botId & content and posts a tweet
app.post('/postTweet', async (req, res) => {
  const { botId, content } = req.body;
  try {
    if (!botId || !content) {
      return res.status(400).json({
        status: 'ERROR',      
        message: 'Bot ID and content are required',
        data: null
      });
    } 
    const tweet = await postTweet(botId, content);
    res.status(200).json({
      status: 'SUCCESS',
      message: 'Tweet posted successfully',
      data: tweet
    });
  } catch (error) {
    console.error('Error posting tweet:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to post tweet',
      data: null
    });
  }
});


// API endpoint example
app.post('/api/v1/mail', async (req, res) => {
  try {
    const { email, type, userData } = req.body;
    
    let result;
    switch (type) {
      case 'marketing':
        result = await sendMarketingEmail(email, userData);
        break;
      case 'welcome':
        result = await sendWelcomeSeriesEmail(email, 1, userData);
        break;
      case 'challenge-failure':
        result = await sendChallengeFailureEmail(email, userData);
        break;
      default:
        throw new Error('Invalid email type');
    }

    res.json({
      status: 'SUCCESS',
      message: 'Marketing email sent successfully',
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'ERROR',
      message: error.message,
      data: null
    });
  }
});

// api for getting landing page data
// More efficient version using joins
app.get('/api/v1/landing', async (req, res) => {
  try {
    // Get counts in parallel
    const [
      { count: userCount, error: userCountError },
      { count: tweetCount, error: tweetCountError },
      { data: latestTweetData, error: latestTweetError }
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('tweets').select('*', { count: 'exact', head: true }),
      supabase
        .from('tweets')
        .select(`
          *,
          bots (
            *,
            users (*)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    ]);

    // Handle errors
    if (userCountError) throw new Error('Failed to fetch user count');
    if (tweetCountError) throw new Error('Failed to fetch tweet count');
    if (latestTweetError) throw new Error('Failed to fetch latest tweet');

    res.json({
      status: 'SUCCESS',
      message: 'Landing page data fetched successfully',
      data: {
        userCount: userCount || 0,
        tweetCount: tweetCount || 0,
        latestTweet: latestTweetData,
        user: latestTweetData?.bots?.users || null,
        bot: latestTweetData?.bots || null
      }
    });
  } catch (error) {
    console.error('Error fetching landing page data:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to fetch landing page data',
      data: null
    });
  }
});

// Start server
const startServer = async () => {
  try {
    await initializeQueue();
    await initializeChallengesQueue();

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();