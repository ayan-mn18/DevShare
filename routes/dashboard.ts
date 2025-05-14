import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { getGithubMetrics } from '../services/github';
import { getLeetCodeMetrics } from '../services/leetcode';
import type { ApiResponse, DashboardData } from '../types/api';

const router = Router();

// Get dashboard data
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'User not found',
        data: null
      });
    }

    let githubMetrics;
    let leetCodeMetrics;

    try {
      if (user.github_username) {
        githubMetrics = await getGithubMetrics(user.github_username);
      }
    } catch (githubError) {
      console.error('Error fetching GitHub metrics:', githubError);
      // Continue with null metrics instead of failing completely
    }

    try {
      if (user.leetcode_username) {
        leetCodeMetrics = await getLeetCodeMetrics(user.leetcode_username);
      }
    } catch (leetCodeError) {
      console.error('Error fetching LeetCode metrics:', leetCodeError);
      // Continue with null metrics instead of failing completely
    }

    res.json({
      status: 'SUCCESS',
      message: 'Dashboard data fetched successfully',
      data: {
        user,
        githubMetrics: githubMetrics || {
          contributions: [],
          totalCommits: 0,
          streak: 0,
          followers: 0
        },
        leetCodeMetrics: leetCodeMetrics || {
          totalSolved: 0,
          streak: 0,
          recentSubmissions: []
        }
      }
    });
  } catch (error) {
    console.error('Error in dashboard route:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'An unexpected error occurred',
      data: null
    });
  }
});

// Add email
router.post('/add-email', async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      email: z.string().email()
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid request parameters',
        data: parseResult.error.format()
      });
    }

    const { userId, email } = parseResult.data;

    const { error } = await supabase
      .from('users')
      .update({ email })
      .eq('id', userId);

    if (error) {
      return res.status(500).json({
        status: 'ERROR',
        message: 'Failed to update email',
        data: error
      });
    }

    res.json({
      status: 'SUCCESS',
      message: 'Email updated successfully',
      data: { email }
    });
  } catch (error) {
    console.error('Error updating email:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'An unexpected error occurred',
      data: null
    });
  }
});

export default router;