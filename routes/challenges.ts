import { Router } from "express";
import { supabase } from "../lib/supabase";
import { z } from 'zod';
import { enrollUserInChallenge } from "../services/challenges";
import { sendEnrollmentEmail } from "../services/email";

const router = Router();

// GET /api/v1/challenges - Get available challenges (only 2)
router.get('/', async (req, res, next) => {
  try {
    const { data: challenges, error } = await supabase
      .from('challenges')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error('Failed to fetch challenges');
    }

    // Get participant counts
    const challengesWithCounts = await Promise.all(
      challenges.map(async (challenge) => {
        const { count } = await supabase
          .from('user_challenges')
          .select('*', { count: 'exact', head: true })
          .eq('challenge_id', challenge.id);

        return {
          ...challenge,
          participant_count: count || 0
        };
      })
    );

    res.json({
      status: 'SUCCESS',
      message: 'Challenges fetched successfully',
      data: challengesWithCounts
    });
  } catch (error) {
    console.error('Error fetching challenges:', error);
    next(error)
  }
});

// POST /api/v1/challenges/user/ - Get user's enrolled challenges
router.post('/user', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ status: 'ERROR', message: 'User ID is required' });
    }

    const { data: userChallenges, error } = await supabase
      .from('user_challenges')
      .select(`
        *,
        challenge:challenges(*)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Failed to fetch user challenges');
    }

    res.json({
      status: 'SUCCESS',
      message: 'User challenges fetched successfully',
      data: userChallenges || []
    });
  } catch (error) {
    console.error('Error fetching user challenges:', error);
    next(error);
  }
});

// POST /api/v1/challenges/enroll - Enroll in a challenge
router.post('/enroll', async (req, res, next) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      challengeId: z.string().uuid(),
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

    const { userId, challengeId, email } = parseResult.data;

    console.log('Enrolling user in challenge:', { userId, challengeId, email });

    const enrollment = await enrollUserInChallenge({ userId, challengeId, email });

    console.log('User enrolled in challenge:', { enrollment });

    // send an email, confirming the enrollment
    await sendEnrollmentEmail(email, enrollment);

    res.json({
      status: 'SUCCESS',
      message: 'Successfully enrolled in challenge',
      data: enrollment
    });
  } catch (error) {
    console.error('Error enrolling in challenge:', error);
    next(error);
  }
});

// POST /api/v1/challenges/progress - Get user's challenge progress
router.post('/progress', async (req, res, next) => {
  try {
    const { userId, challengeId } = req.body;
    if (!userId || !challengeId) {
      return res.status(400).json({ status: 'ERROR', message: 'User ID and Challenge ID are required' });
    } 

    // fetch user challenge

    const { data: userChallenge, error: challengeError } = await supabase
      .from('user_challenges')
      .select('*')
      .eq('user_id', userId)
      .eq('challenge_id', challengeId)
      .eq('is_active', true)
      .single();
    if (challengeError || !userChallenge) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Challenge not found for this user',
        data: null
      });
    }

    const { data: progress, error } = await supabase
      .from('daily_challenge_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('challenge_id', challengeId)
      .eq('user_challenge_id', userChallenge.id)
      .order('date', { ascending: true })
      .limit(100) // Limit to last 100 entries
    if (error) {
      throw new Error('Failed to fetch challenge progress');
    } 
    res.json({
      status: 'SUCCESS',
      message: 'Challenge progress fetched successfully',
      data: progress || {}
    });
  } catch (error) {
    console.error('Error fetching challenge progress:', error);
    next(error);
  }
});

export default router;
