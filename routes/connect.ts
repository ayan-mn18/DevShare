import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';
import { supabase } from '../lib/supabase';
import { tweetQueue } from '../lib/queue';
import { addTweetBotToQueue, generateAuthUrl, handleCallback } from '../services/twitter';
import { validateGithubUsername } from '../services/github';
import { validateLeetCodeUsername } from '../services/leetcode';
import type { ApiResponse } from '../types/api';

const router = Router();

// Initialize X (Twitter) OAuth flow
router.post('/x', async (req, res) => {
  try {

    const { userId } = req.body;

    const { url, codeVerifier, state } = await generateAuthUrl(userId);


    console.log('Generated OAuth URL:', url);
    console.log('Code Verifier:', codeVerifier);
    console.log('State:', state);
    res.json({
      status: 'SUCCESS',
      message: 'OAuth URL generated successfully',
      data: { url, codeVerifier, state }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation error:', error.errors);
      const errorMessage = `Invalid request parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      throw new ApiError(400, errorMessage);
    }
    throw error;
  }
});

// Handle X (Twitter) OAuth callback
router.post('/x/callback', async (req, res) => {
  try {

    const { code, state, codeVerifier } = req.body;

    console.log('Callback received with:', { 
      code_length: code?.length,
      state_length: state?.length,
      verifier_length: codeVerifier?.length,
    });
    if (!code || !state || !codeVerifier) {
      throw new ApiError(400, 'Missing required parameters');
    }

    const result = await handleCallback(code, state, codeVerifier);

    // Add bot to tweet queue for daily updates
    console.log('Adding job to queue:', {
      userId: result.user.id,
      botId: result.bot.id});
    const jobData = await addTweetBotToQueue(result.user.id, result.bot.id);

    res.json({
      status: 'SUCCESS',
      message: 'Successfully connected Twitter account',
      data: result
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, 'Invalid request parameters');
    }
    throw error;
  }
});

// Connect LeetCode account
router.post('/leetcode', async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      username: z.string().min(1)
    });

    const { userId, username } = schema.parse(req.body);

    const isValid = await validateLeetCodeUsername(username);
    if (!isValid) {
      throw new ApiError(400, 'Invalid LeetCode username');
    }

    const { error } = await supabase
      .from('users')
      .update({ leetcode_username: username })
      .eq('id', userId);

    if (error) {
      throw new ApiError(500, 'Failed to update LeetCode username');
    }

    res.json({
      status: 'SUCCESS',
      message: 'LeetCode account connected successfully',
      data: { username }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, 'Invalid request parameters');
    }
    throw error;
  }
});

// Connect GitHub account
router.post('/github', async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      username: z.string().min(1)
    });

    const { userId, username } = schema.parse(req.body);

    const isValid = await validateGithubUsername(username);
    if (!isValid) {
      throw new ApiError(400, 'Invalid GitHub username');
    }

    const { error } = await supabase
      .from('users')
      .update({ github_username: username })
      .eq('id', userId);

    if (error) {
      console.error('Error updating GitHub username:', error);
      throw new ApiError(500, 'Failed to update GitHub username');
    }

    res.json({
      status: 'SUCCESS',
      message: 'GitHub account connected successfully',
      data: { username }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, 'Invalid request parameters');
    }
    throw error;
  }
});

export default router;