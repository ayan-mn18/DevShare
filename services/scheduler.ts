import { Job } from 'bullmq';
import { getGithubMetrics } from './github';
import { getLeetCodeMetrics } from './leetcode';
import { postTweet } from './twitter';
import { supabase } from '../lib/supabase';

interface TweetJobData {
  userId: string;
  botId: string;
}

export async function processTweetSchedule(job: Job<TweetJobData>) {
  const { userId, botId } = job.data;

  try {
    // Get user info
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('github_username, leetcode_username')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      throw new Error('User not found');
    }

    // Fetch metrics
    const [githubMetrics, leetcodeMetrics] = await Promise.all([
      user.github_username ? getGithubMetrics(user.github_username) : null,
      user.leetcode_username ? getLeetCodeMetrics(user.leetcode_username) : null
    ]);

    // Generate tweet content
    const content = generateTweetContent(githubMetrics, leetcodeMetrics);

    console.log('Generated tweet content:', content);

    // Post tweet
    await postTweet(botId, content);

    // Store tweet in database
    await supabase
      .from('tweets')
      .insert({
        bot_id: botId,
        content,
        schedule_time: new Date().toISOString(),
        status: 'sent',
        github_contribution: githubMetrics?.totalCommits || -1,
        leetcode_contribution: leetcodeMetrics?.totalSolved || -1
      });

    return { success: true };
  } catch (error) {
    console.error('Tweet scheduling failed:', error.message);
    throw error;
  }
}

function generateTweetContent(
  githubMetrics: Awaited<ReturnType<typeof getGithubMetrics>> | null,
  leetcodeMetrics: Awaited<ReturnType<typeof getLeetCodeMetrics>> | null
): string {
  const parts: Array<string> = [];

  if (githubMetrics) {
    // take last contribution date
    const last24HrsContributions = githubMetrics.contributions[0].count;
    // ignore ts error
    parts.push(`🚀 Made ${last24HrsContributions} contributions on GitHub today!`);
  }

  if (leetcodeMetrics) {
    // filter out the submissions that are older than 24 hours  
    const last24HrsSubmissions = leetcodeMetrics.recentSubmissions.filter(submission => {
      const submissionDate = new Date(submission.timestamp);
      return submissionDate >= new Date(Date.now() - 24 * 60 * 60 * 1000);
    });
    if(last24HrsSubmissions.length > 0) {
      const totalSolved = last24HrsSubmissions.length;
      // if the list is more than 4 then take the name of first 4 questions solved with their difficulty, and generate tweet content accordingly
      const questions = last24HrsSubmissions.slice(0, 4).map(submission => {
        return `${submission.title} (${submission.difficulty})`;
      }
      ).join(', ');
      parts.push(`🧩 Solved ${questions} on LeetCode today!`);
      if (totalSolved > 4) {
        parts.push(`...and ${totalSolved - 4} more!`);
      }
      parts.push(`💻 Solved ${totalSolved} LeetCode problems with a ${leetcodeMetrics.streak}-day streak!`);
    }
  }

  if (parts.length === 0) {
    return "Another productive day of coding! 💻✨";
  }

  return parts.join('\n') + '\n\n#coding #developer #100DaysOfCode';
}