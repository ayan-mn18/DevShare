import crypto from 'crypto';
import { ApiError } from '../middleware/errorHandler';
import { supabase } from '../lib/supabase';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { tweetQueue } from '../lib/queue';


const TWITTER_API_URL = 'https://api.twitter.com/2';

interface TwitterTokens {
  access_token: string;
  refresh_token: string;
}

interface TwitterUser {
  id: string;
  username: string;
  name: string;
}

// Store state parameters temporarily (in production, use Redis)
const stateStore = new Map<string, { userId: string; expiresAt: number }>();

export async function generateAuthUrl(userId: string) {
  const state = crypto.randomBytes(32).toString('hex');
  // TODO - Use a more secure random string generator for production
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Store state with userId (expires in 10 minutes)
  stateStore.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID!,
    redirect_uri: process.env.TWITTER_CALLBACK_URL!,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return {
    url: `https://twitter.com/i/oauth2/authorize?${params .toString()}`,
    codeVerifier,
    state
  };
}

export async function handleCallback(code: string, state: string, codeVerifier: string) {
  const storedState = stateStore.get(state);
  // TODO - Uncomment this in production
  if (!storedState) {
    throw new ApiError(400, 'Invalid state parameter');
  }
  // if (!storedState || Date.now() > storedState.expiresAt) {
  //   throw new ApiError(400, 'Invalid or expired state parameter');
  // }

  const tokens = await exchangeCodeForTokens(code, codeVerifier);
  const twitterUser = await getTwitterUser(tokens.access_token);

  console.log('Twitter user:', twitterUser);

  // Check if user already exists in the database by twitter username
  let user: any;
  const { data: existingUser, error: existingUserError } = await supabase
    .from('users')
    .select('id')
    .eq('twitter_username', twitterUser.username)
    .single();
  // if user does not exist, create a new user
  if (existingUserError && existingUserError.code !== 'PGRST116') {
    throw new ApiError(500, 'Failed to check existing user');
  }
  if (!existingUser) {
    // Create & return a new user if not found
    const { data: newUser, error: createUserError } = await supabase
      .from('users')
      .insert({
        id: uuidv4(),
        name: twitterUser.name,
        twitter_username: twitterUser.username,
        created_at: new Date()
      })
      .select()
      .single();
    if (createUserError) {
      console.error('Create user error:', createUserError);
      throw new ApiError(500, 'Failed to create user');
    }
    user = newUser;
  } else {
    // If user exists, update their Twitter info & get back user object
    const { data: updatedUser, error: updateUserError } = await supabase
      .from('users')
      .update({
        name: twitterUser.name,
        twitter_username: twitterUser.username,
        updated_at: new Date()
      })
      .eq('id', existingUser.id)
      .select()
      .single();
    if (updateUserError) {
      console.error('Update user error:', updateUserError);
      throw new ApiError(500, 'Failed to update user');
    }

    user = updatedUser;
  }


  // Create bot for the user
  // Check if bot already exists
  let bot: any;
  const { data: existingBot, error: existingBotError } = await supabase
    .from('bots')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (existingBotError && existingBotError.code !== 'PGRST116') {
    throw new ApiError(500, 'Failed to check existing bot');
  }
  if (!existingBot) {
    // If bot does not exists, create a new bot
  const { data: newBot, error: botError } = await supabase
    .from('bots')
    .insert({
      user_id: user.id,
      name: `${twitterUser.username}'s Bot`,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    })
    .select()
    .single();
    if (botError) {
      throw new ApiError(500, 'Failed to create bot');
    }
    bot = newBot;
  } else {  
    // If bot exists, update the access token & refresh token
    const { data: updatedBot, error: updateBotError } = await supabase
      .from('bots')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      })
      .eq('id', existingBot.id)
      .select()
      .single();
    if (updateBotError) {
      console.error('Update bot error:', updateBotError);
      throw new ApiError(500, 'Failed to update bot');
    } 
    bot = existingBot;
  }

  stateStore.delete(state);

  console.log('User response:', user); 
  console.log('Bot response:', bot);

  return { user, bot };
}

export async function postTweet(botId: string, content: string) {
  // get the bot's access token & refresh token from the database
  const { data: bot, error: botError } = await supabase
    .from('bots')
    .select('access_token, refresh_token')
    .eq('id', botId)
    .single();

  if (botError || !bot?.access_token || !bot?.refresh_token) {
    throw new ApiError(404, 'Bot not found');
  }
  // first create the access token using the refresh token from x apis
  // then save the new access token & refresh token to the database, the use the new access token to post the tweet

  // Refresh the token before posting the tweet
  let accessToken = bot.access_token;
  try {
    // Attempt to refresh the token
    const refreshedTokens = await refreshTwitterToken(bot.refresh_token);
    
    // Update tokens in the database
    const { error: updateError } = await supabase
      .from('bots')
      .update({
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token
      })
      .eq('id', botId);
    
    if (updateError) {
      console.error('Failed to update tokens in database:', updateError);
      // Continue with old token if update fails
    } else {
      // Use the new access token
      accessToken = refreshedTokens.access_token;
    }
  } catch (error) {
    console.error('Token refresh failed, trying with existing token:', error);
    // Continue with the old token if refresh fails
    accessToken = bot.access_token;
  }

  console.log('Access token used to post tweet:', accessToken);
   // Use axios instead of fetch for more detailed error reporting
   const response = await axios({
    method: 'post',
    url: `${TWITTER_API_URL}/tweets`,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    data: { text: "Smile Its Sunnah" },
    timeout: 15000 // 15 second timeout
  });

  console.log('Tweet posted successfully, status:', response.status);

  if (response.status !== 201) {
    console.error('Failed to post tweet:', response.data);
    throw new ApiError(500, 'Failed to post tweet');
  }
  console.log('Tweet response:', response.data);

  // enter this tweet into the database as well
  const { data: tweetData, error: tweetError } = await supabase
    .from('tweets')
    .insert({
      bot_id: botId,
      content,
      created_at: new Date(),
      schedule_time: new Date(),
      status: 'SENT',
      github_contribution: 0,
      leetcode_contribution: 0
    })
    .select()
    .single();
  if (tweetError) {
    console.error('Tweet error:', tweetError);
    throw new ApiError(500, 'Failed to save tweet to database');
  }
  console.log('Tweet data:', tweetData);

  return response.data;
}

/**
 * Exchanges an authorization code for access and refresh tokens
 * @param code The authorization code from Twitter
 * @param codeVerifier The code verifier used in the PKCE flow
 * @returns Twitter access and refresh tokens
 */
async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TwitterTokens> {
  try {
    // Log sanitized request information
    console.log('Starting token exchange', {
      codeLength: code?.length,
      verifierLength: codeVerifier?.length,
      redirectUri: process.env.TWITTER_CALLBACK_URL
    });
    
    // Prepare request parameters
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.TWITTER_CALLBACK_URL!,
      code_verifier: codeVerifier
    });

    console.log('Request parameters:', params);
    
    // Generate auth credentials
    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');
    
    // Make the token request
    const response = await axios({
      method: 'post',
      url: 'https://api.twitter.com/2/oauth2/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json'
      },
      data: params,
      timeout: 10000 // 10 second timeout
    });

    console.log('response:', response.data);
    
    console.log('Token exchange successful');
    return response.data;
    
  } catch (error) {
    // Enhanced error handling
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500;
      const responseData = error.response?.data || {};
      
      console.error('Twitter token exchange failed:', {
        status: statusCode,
        statusText: error.response?.statusText,
        error: responseData,
        message: error.message
      });
      
      // Return more specific error messages
      if (statusCode === 401) {
        throw new ApiError(401, 'Authentication failed: Check client credentials');
      } else if (statusCode === 400) {
        throw new ApiError(400, `Invalid request: ${JSON.stringify(responseData)}`);
      }
      
      throw new ApiError(statusCode, `Failed to exchange code for tokens: ${JSON.stringify(responseData)}`);
    }
    
    // Handle non-axios errors
    console.error('Unexpected error during token exchange:', error);
    throw new ApiError(500, 'An unexpected error occurred during authentication');
  }
}

async function getTwitterUser(accessToken: string): Promise<TwitterUser> {
  const response = await fetch(`${TWITTER_API_URL}/users/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    console.error("response:", response);
    // throw new ApiError(500, 'Failed to get Twitter user info');
  }

  const { data } = await response.json();
  return data;
}


/**
 * Refreshes a Twitter access token using a refresh token
 * @param refreshToken The refresh token to use
 * @returns New access and refresh tokens
 */
async function refreshTwitterToken(refreshToken: string): Promise<TwitterTokens> {
  try {
    // Prepare request parameters
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    
    // Generate auth credentials
    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');
    
    // Make the token refresh request
    const response = await axios({
      method: 'post',
      url: 'https://api.twitter.com/2/oauth2/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      data: params,
      timeout: 8000 // 8 second timeout
    });
    
    console.log('Token refresh response:', response.data);

    return response.data;
    
  } catch (error) {
    // Enhanced error handling
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500;
      const responseData = error.response?.data || {};
      
      console.error('Twitter token refresh failed:', {
        status: statusCode,
        statusText: error.response?.statusText,
        error: responseData,
        message: error.message
      });
      
      throw new ApiError(statusCode, `Failed to refresh token: ${JSON.stringify(responseData)}`);
    }
    
    // Handle non-axios errors
    console.error('Unexpected error during token refresh:', error);
    throw new ApiError(500, 'An unexpected error occurred during token refresh');
  }
}


export async function addTweetBotToQueue(userId: string, botId: string) {
  // Add the tweet to the queue for the user
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
      const jobData = await tweetQueue.add(
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
      return jobData;
}