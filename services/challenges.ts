import { stat } from "fs";
import { challengeQueue, tweetQueue } from "../lib/queue";
import { supabase } from "../lib/supabase";
import { addTweetBotToQueue } from "./twitter";

export interface ChallengeEnrollmentData {
  userId: string;
  challengeId: string;
  email: string;
}

export interface DailyProgressData {
  userChallengeId: string;
  dayNumber: number;
  date: string;
  leetcodeQuestions: Array<{
    title: string;
    difficulty: string;
    timestamp: string;
    slug?: string;
  }>;
  githubCommits: number;
}

export async function enrollUserInChallenge({ userId, challengeId, email }: ChallengeEnrollmentData) {
  try {
    // Check if user already has active challenge of same type
    const { data: existingChallenge } = await supabase
      .from('user_challenges')
      .select('*')
      .eq('user_id', userId)
      .eq('challenge_id', challengeId)
      .eq('is_active', true);

    if (existingChallenge && existingChallenge.length > 0) {
      throw new Error('User already enrolled in this challenge');
    }

    // Get challenge details
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      throw new Error('Challenge not found');
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + challenge.duration_days);

    // Create enrollment
    const { data: enrollment, error } = await supabase
      .from('user_challenges')
      .insert({
        user_id: userId,
        challenge_id: challengeId,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        email_id: email,
        is_active: true
      })
      .select()
      .single();

    if (error || !enrollment) {
      throw new Error('Failed to enroll in challenge');
    }

    // Add challenge tracking job to queue
    await addChallengeTrackingJob(userId, enrollment.id, challenge.title);

    return enrollment;
  } catch (error) {
    console.error('Error enrolling user in challenge:', error);
    throw error;
  }
}

export async function addChallengeTrackingJob(userId: string, userChallengeId: string, challengeTitle: string) {
  try {
    // find the bot for the user
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('*')
      .eq('user_id', userId)
      .single();  

    if (botError || !bot) {
      throw new Error('Failed to find bot');
    }

    // Add daily tracking job to the queue which runs at every 24 hours
    const data = {
      userId,
      userChallengeId,
      challengeTitle,
      botId: bot.id
    };

    const jobData = await challengeQueue.add(
            `ChallengeTracking-${userId}-${challengeTitle}`,
            data,
            { 
              repeat: { 
                // @ts-ignore
                cron: '0 0 * * *', // Every day at midnight
                tz: 'Asia/Kolkata'  // IST timezone
              }
            }
          );

    console.log(`Added challenge tracking jobs for user ${userId}`);
  } catch (error) {
    console.error('Error adding challenge tracking job:', error);
    throw error;
  }
}