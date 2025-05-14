import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { config } from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { initializeQueue } from './lib/queue';
import connectRoutes from './routes/connect';
import tweetRoutes from './routes/tweet';
import dashboardRoutes from './routes/dashboard';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { tweetQueue } from './lib/queue';

config();

const app = express();
const port = process.env.PORT || 3003;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Routes
app.use('/api/v1/connect', connectRoutes);
app.use('/api/v1/tweet', tweetRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Error handling
app.use(errorHandler);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
  queues: [new BullMQAdapter(tweetQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// Start server
const startServer = async () => {
  try {
    await initializeQueue();
    
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();