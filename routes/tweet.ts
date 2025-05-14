import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';
import { supabase } from '../lib/supabase';
import { postTweet } from '../services/twitter';
import type { ApiResponse, Tweet } from '../types/api';
import { addJob, tweetQueue } from '../lib/queue';

const router = Router();

// Get user's tweets
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'User not found',
        data: null
      });
    }
    // Get user's bot
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('id')
      .eq('user_id', userId)
      .single();
    if (botError || !bot) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Bot not found',
        data: null
      });
    }

    const { data: tweets, error: tweetsError } = await supabase
      .from('tweets')
      .select('*')
      .eq('bot_id', bot.id)
      .order('schedule_time', { ascending: true });

    if (tweetsError) {
      return res.status(500).json({
        status: 'ERROR',
        message: 'Failed to fetch tweets',
        data: null
      });
    }

    res.json({
      status: 'SUCCESS',
      message: 'Tweets fetched successfully',
      data: tweets
    });
  } catch (error) {
    console.error('Error fetching tweets:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'An unexpected error occurred',
      data: null
    });
  }
});

// Send test tweet
router.post('/test', async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      content: z.string().min(1).max(280)
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid request parameters',
        data: parseResult.error.format()
      });
    }

    const { userId, content } = parseResult.data;

    // Check if user exists and hasn't used test tweet
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('test_tweet_used')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'User not found',
        data: null
      });
    }

    if (user.test_tweet_used) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Test tweet has already been used',
        data: null
      });
    }

    // Get user's bot
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('id, access_token')
      .eq('user_id', userId)
      .single();

    if (botError || !bot) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Bot not found',
        data: null
      });
    }

    // Post tweet
    try {
      await postTweet(bot.id, content);
    } catch (tweetError) {
      return res.status(500).json({
        status: 'ERROR',
        message: 'Failed to post tweet',
        data: null
      });
    }

    // Mark test tweet as used
    await supabase
      .from('users')
      .update({ test_tweet_used: true })
      .eq('id', userId);

    res.json({
      status: 'SUCCESS',
      message: 'Test tweet sent successfully',
      data: null
    });
  } catch (error) {
    console.error('Error sending test tweet:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'An unexpected error occurred',
      data: null
    });
  }
});

export default router;


router.post('/schedule', async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      botId: z.string().uuid()
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid request parameters',
        data: parseResult.error.format()
      });
    }

    const { userId, botId } = parseResult.data;

    // Verify user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, github_username, leetcode_username')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'User not found',
        data: null
      });
    }
     // Verify bot exists and belongs to user
    const { data: bot, error: botError } = await supabase
    .from('bots')
    .select('id')
    .eq('id', botId)
    .eq('user_id', userId)
    .single();

  if (botError || !bot) {
    return res.status(404).json({
      status: 'ERROR',
      message: 'Bot not found or not associated with this user',
      data: null
    });
  }

  // Add job to queue, to be processed in 10 seconds
  const jobId = await addJob('tweet', {
    userId,
    botId
  }, {
    delay: 10000, // 10 seconds
    attempts: 3
  });

  // Create a scheduled tweet entry in the database
  const scheduledTime = new Date();
  scheduledTime.setSeconds(scheduledTime.getSeconds() + 10);
  const { data: scheduledTweet, error: scheduleError } = await supabase
      .from('tweets')
      .insert({
        bot_id: botId,
        content: 'Scheduled tweet being generated...',
        created_at: new Date().toISOString(),
        schedule_time: scheduledTime.toISOString(),
        status: 'PENDING',
        github_contribution: 0,
        leetcode_contribution: 0,
      })
      .select()
      .single();

    if (scheduleError) {
      console.error('Error scheduling tweet:', scheduleError);
      return res.status(500).json({
        status: 'ERROR',
        message: 'Failed to schedule tweet',
        data: null
      });
    }

    res.json({
      status: 'SUCCESS',
      message: 'Tweet scheduled successfully',
      data: {
        id: scheduledTweet.id,
        jobId,
        scheduledTime: scheduledTime.toISOString()
      }
    });
  } catch (error) {
    console.error('Error scheduling tweet:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'An unexpected error occurred',
      data: null
    });
  }
});


router.post('/test-queue-logic', async (req, res) => {
  try {
    const { userId, botId } = req.body;

    // Check if the job already exists
    const existingJob = await tweetQueue.getRepeatableJobs();
    console.log('Existing jobs:', existingJob);
    // find the job with the same name and data
    const jobExists = existingJob.filter(job =>
      job.name === `DailyUpdate-${userId}`)

    console.log('Job exists:', jobExists);

    if (jobExists.length > 0) {
      await tweetQueue.removeRepeatable('daily-update', {
        key: jobExists[0].key,
      });
      console.log('Removed existing job:');
    }

    // Add the job to the queue
    await tweetQueue.add(
      `DailyUpdate-${userId}`,
      { userId, botId },
      { 
        repeat: { 
          cron: '0 0 * * *', // Every day at midnight
          tz: 'Asia/Kolkata'  // IST timezone
        }
      }
    );
    console.log('Added new job to queue');

    res.json({
      status: 'SUCCESS',
      message: 'Job added to queue successfully',
      data: null
    });
  } catch (error) {
    console.error('Error adding job to queue:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to add job to queue',
      data: null
    });
  }
}
);
