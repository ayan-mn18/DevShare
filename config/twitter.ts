import { config } from 'dotenv';

config();

export const twitterConfig = {
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
  callbackUrl: process.env.TWITTER_CALLBACK_URL,
  scope: ['tweet.read', 'tweet.write', 'users.read'].join(' ')
};

if (!twitterConfig.clientId || !twitterConfig.clientSecret || !twitterConfig.callbackUrl) {
  throw new Error('Missing Twitter OAuth configuration');
}