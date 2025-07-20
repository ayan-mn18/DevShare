import { Job } from 'bullmq';
import { getGithubMetrics } from './github';
import { getLeetCodeMetrics } from './leetcode';
import { postTweet } from './twitter';
import { supabase } from '../lib/supabase';
import { openai } from './openai';
import { get } from 'http';
import { challengeQueue, ChallengeTweetJobData } from '../lib/queue';
import { boolean } from 'zod';
import { sendChallengeFailureEmail } from './email';

interface TweetJobData {
  userId: string;
  botId: string;
}

interface ChallengeProgress {
  challengeTitle: string;
  last24HrsLeetCodeSubmissions: Array<{
    title: string;
    difficulty: string;
    timestamp: string;
  }>;
  day_number: number;
}

const NO_PROGRESS = "No Progress";

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
      user.github_username ? getGithubMetrics(user.github_username, true) : null,
      user.leetcode_username ? getLeetCodeMetrics(user.leetcode_username) : null
    ]);



    // Generate tweet content
    const content = await generateTweetContent(githubMetrics, leetcodeMetrics);

    if (content === NO_PROGRESS) {
      console.log('No progress to tweet.');
      return { success: true };
    }

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
    // @ts-ignore
    console.error('Tweet scheduling failed:', error.message);
    throw error;
  }
}

// function generateTweetContent(
//   githubMetrics: Awaited<ReturnType<typeof getGithubMetrics>> | null,
//   leetcodeMetrics: Awaited<ReturnType<typeof getLeetCodeMetrics>> | null
// ): string {
//   const parts: Array<string> = [];

//   if (githubMetrics) {
//     // take last contribution date
//     const last24HrsContributions = githubMetrics.contributions[0].count;
//     // ignore ts error
//     parts.push(`🚀 Made ${last24HrsContributions} contributions on GitHub today!`);
//   }

//   if (leetcodeMetrics) {
//     // filter out the submissions that are older than 24 hours  
//     const last24HrsSubmissions = leetcodeMetrics.recentSubmissions.filter(submission => {
//       const submissionDate = new Date(submission.timestamp);
//       return submissionDate >= new Date(Date.now() - 24 * 60 * 60 * 1000);
//     });
//     if(last24HrsSubmissions.length > 0) {
//       const totalSolved = last24HrsSubmissions.length;
//       // if the list is more than 4 then take the name of first 4 questions solved with their difficulty, and generate tweet content accordingly
//       const questions = last24HrsSubmissions.slice(0, 4).map(submission => {
//         return `${submission.title} (${submission.difficulty})`;
//       }
//       ).join(', ');
//       parts.push(`🧩 Solved ${questions} on LeetCode today!`);
//       if (totalSolved > 4) {
//         parts.push(`...and ${totalSolved - 4} more!`);
//       }
//       parts.push(`💻 Solved ${totalSolved} LeetCode problems with a ${leetcodeMetrics.streak}-day streak!`);
//     }
//   }

//   if (parts.length === 0) {
//     return "Another productive day of coding! 💻✨";
//   }

//   return parts.join('\n') + '\n\n#coding #developer #100DaysOfCode';
// }

const tones = [
  "funny",
  "motivational",
  "sarcastic",
  "chill",
  "developerProTip",
  "hype",
  "nerdy",
  "poetic",
  "dramatic",
  "spicy",
  "honest",
  "lateNightThoughts",
  "memeStyle"
];

const hashtagsPool = [
  "#100DaysOfCode",
  "#buildinpublic",
  "#devlife",
  "#TechTwitter",
  "#javascript",
  "#typescript",
  "#reactjs",
  "#nodejs",
  "#coding",
  "#developer",
  "#opensource",
  "#CleanCode",
  "#leetcode",
  "#bugfixes",
  "#programming",
  "#codingLife",
  "#programmingHumor",
  "#webdev",
  "#productivity",
  "#indiehackers",
  "#shipit",
  "#sideproject",
  "#remotework",
  "#debugging",
  "#frontend",
  "#backend",
  "#softwareengineering",
  "#codeNewbie",
  "#commitment",
  "#learningInPublic",
  "#AI",
  "#automation",
  "#devmemes",
  "#todayilearned",
  "#github"
];

function getRandomSubset<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export async function generateTweetContent(
  githubMetrics: Awaited<ReturnType<typeof getGithubMetrics>> | null,
  leetcodeMetrics: Awaited<ReturnType<typeof getLeetCodeMetrics>> | null
): Promise<string> {
  const facts: string[] = [];

  if (githubMetrics) {
    const count = githubMetrics.contributions[0].count;
    if (count > 0) {
          facts.push(`GitHub contributions today: ${count}`);
    }  
  }

  if (leetcodeMetrics) {
    const last24HrsSubmissions = leetcodeMetrics.recentSubmissions.filter((submission) => {
      const submissionDate = new Date(submission.timestamp);
      return submissionDate >= new Date(Date.now() - 24 * 60 * 60 * 1000);
    });

    if (last24HrsSubmissions.length > 0) {
      const total = last24HrsSubmissions.length;
      const questions = last24HrsSubmissions.slice(0, 4).map((s) => `${s.title} (${s.difficulty})`).join(', ');
      facts.push(`Solved ${total} problems on LeetCode: ${questions}`);
      facts.push(`Current LeetCode streak: ${leetcodeMetrics.streak} days`);
    }
  }

  console.log('Generated facts:', facts); 

  if (facts.length === 0) {
    return NO_PROGRESS;
  }

  const tone = tones[Math.floor(Math.random() * tones.length)];
  const hashtags = getRandomSubset(hashtagsPool, Math.floor(Math.random() * 4) + 2).join(" ");

  const prompt = `
You are a developer sharing your coding progress on Twitter in a way that grabs attention, entertains, or inspires.

Facts:
${facts.map((f) => `- ${f}`).join('\n')}

Instructions:
- Write a tweet under 280 characters
- Style: ${tone}
- Make it original and interesting, not generic or templated
- Use emojis naturally if needed
- Include these hashtags at the end: ${hashtags}
- Try humor, analogies, drama, poetic flair, developer memes, or pro tips — based on the tone

Examples:
- "Only 2 commits today but they were spicy 🌶️🔥 Cleaned up legacy code that looked like ancient hieroglyphs. #buildinpublic #CleanCode #devlife"
- "Leetcode hit me with 4 medium problems. I hit back with ACs. It’s a war out here 💣🧠 #leetcode #programming #shipit"
- "No commits today, but I refactored my mindset. Growth doesn’t always mean output 🚀 #100DaysOfCode #developer #lateNightThoughts"
- "Code didn't compile. Cried a little. Fixed a semicolon. I'm back baby 😤💻 #devmemes #javascript #debugging"
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4", // or gpt-3.5-turbo
    messages: [
      { role: "system", content: "You are a creative tweet generator for a quirky developer sharing daily progress." },
      { role: "user", content: prompt }
    ],
    temperature: 0.95,
    max_tokens: 120,
  });

  const rawTweet = response.choices[0].message.content?.trim() || "";
  const cleanedTweet = rawTweet.replace(/^["']|["']$/g, ""); // removes surrounding quotes if present

  return cleanedTweet || "Wrote code. Broke things. Fixed them. Shipped. #devlife #buildinpublic";
}


export async function trackChallengesProgress(job: Job<ChallengeTweetJobData>) {
  const { userId, userChallengeId, challengeTitle, botId } = job.data;
  try {
    // fetch challenge progress
    const challengeProgress = await getChallengeProgress(userId, userChallengeId, challengeTitle);

    let challengeFailed = false;
    // generate tweet content
    const tweetContent = await generateChallengeAwareTweetContent({
      challengeTitle,
      dayNumber: challengeProgress.day_number || 1,
      leetcodeQuestions: challengeProgress.last24HrsLeetCodeSubmissions,
      githubCommits: 0, // Assuming no GitHub commits for this challenge,
      challengeFailed
    });

    if (!tweetContent) {
      throw new Error('No progress to tweet');
    }

    // post tweet
    const tweetData =  await postTweet(botId, tweetContent);
    console.log('Tweet posted successfully:', tweetData);
    // update the tweet data daily progress
    const { data: dailyProgress, error: progressError } = await supabase
      .from('challenge_daily_progress')
      .update({
        tweet_posted: true,
        tweet_url: tweetData.url,
        leetcode_questions: challengeProgress.last24HrsLeetCodeSubmissions.map(submission => ({
          title: submission.title,
          difficulty: submission.difficulty,
          timestamp: submission.timestamp
        }))
      })
      .eq('id', challengeProgress.dailyProgressId)
      .select()
      .single();    


      if( challengeFailed ) {
      const { data: updatedChallenge, error: updateError } = await supabase
      .from('user_challenges')
      .update({
        is_active: false,
        failed_on_day: challengeProgress.day_number,
      })
      .eq('id', userChallengeId)
      .select('*')
      .single();

      if (updateError) {
      console.error('Error updating challenge status:', updateError);
      throw new Error('Failed to mark challenge as failed');
    }

      // remove this challenge from the queue
      await removeChallengeFromQueue(userChallengeId, userId, job);

      // send failure email
      await sendChallengeFailureEmail(updatedChallenge.email,{ challengeTitle, failed_at_day: challengeProgress.day_number, userId});
    }

    return { success: true, content: tweetContent, dailyProgress };
  } catch (error) {
    console.error('Error tracking challenge progress:', error);
    throw error;
  }
}

// Add this helper function
async function removeChallengeFromQueue(userChallengeId: string, userId: string, currentJob: Job) {
  try {
    // 1. Remove the repeatable pattern if it exists
    if (currentJob.opts?.repeat) {
      const jobId = `challenge_${userChallengeId}`;
      await challengeQueue.removeRepeatable(currentJob.name, currentJob.opts.repeat, jobId);
      console.log(`Removed repeatable pattern for challenge ${userChallengeId}`);
    }

    // 2. Remove current job
    await currentJob.remove();
    console.log(`Removed current job for challenge ${userChallengeId}`);

    // 3. Find and remove any other related jobs
    const allJobs = await challengeQueue.getJobs(['waiting', 'delayed', 'active']);
    const relatedJobs = allJobs.filter(job => 
      job.data.userChallengeId === userChallengeId && job.data.userId === userId
    );

    for (const job of relatedJobs) {
      if (job.id !== currentJob.id) { // Don't try to remove the current job again
        try {
          if (job.opts?.repeat) {
            await challengeQueue.removeRepeatable(job.name, job.opts.repeat, job.id);
          }
          await job.remove();
          console.log(`Removed related job ${job.id}`);
        } catch (jobError) {
          console.error(`Error removing job ${job.id}:`, jobError);
        }
      }
    }

    return { success: true, message: `Removed all jobs for challenge ${userChallengeId}` };
  } catch (error: any) {
    console.error('Error removing challenge from queue:', error);
    // Don't throw - we still want the challenge to be marked as failed in DB
    return { success: false, error: error.message };
  }
}


export async function generateChallengeAwareTweetContent(data: {
  challengeTitle: string;
  dayNumber: number;
  leetcodeQuestions: any[];
  githubCommits: number;
  challengeFailed?: boolean;
}): Promise<string> {
  let { challengeTitle, dayNumber, leetcodeQuestions, githubCommits, challengeFailed } = data;

  const facts: string[] = [];
  let challengeHashtags: string[] = [];

  // Build facts based on challenge type
  if (challengeTitle === '100_days_leetcode') {
    challengeHashtags = ['#100DaysOfLeetCode', '#leetcode', '#challenge'];
    
    if (leetcodeQuestions.length > 0) {
      const questionTitles = leetcodeQuestions.slice(0, 3).map(q => 
        `${q.title} (${q.difficulty})`
      ).join(', ');
      
      facts.push(`Day ${dayNumber}/100 of #100DaysOfLeetCode`);
      facts.push(`Solved ${leetcodeQuestions.length} problem${leetcodeQuestions.length > 1 ? 's' : ''}: ${questionTitles}`);
    }
  } else if (challengeTitle === 'daily_leetcode_github') {
    challengeHashtags = ['#100DaysOfCode', '#leetcode', '#buildinpublic'];
    
    facts.push(`Daily grind update:`);
    if (leetcodeQuestions.length > 0) {
      facts.push(`LeetCode: ${leetcodeQuestions.length} problems solved`);
    }
    if (githubCommits > 0) {
      facts.push(`GitHub: ${githubCommits} commits pushed`);
    }
  }

  if (facts.length === 0) {
    // send a failure mail & tweet
    if(challengeTitle === '100_days_leetcode') {
      challengeFailed = true;
      return await generateChallengeFailureTweet({
        challengeTitle: '100 Days of LeetCode',
        dayNumber,
        challengeType: '100_days_leetcode',
        isStrict: true
      });
    } 
    return NO_PROGRESS;
  }

  const allHashtags = [...challengeHashtags, '#DevShare'].join(' ');

  const tones = [
    "motivational",
    "accomplished", 
    "determined",
    "consistent",
    "focused"
  ];

  const tone = tones[Math.floor(Math.random() * tones.length)];

  const prompt = `
You are a developer sharing your coding challenge progress on Twitter. You're committed to consistency and growth.

Facts:
${facts.map((f) => `- ${f}`).join('\n')}

Instructions:
- Write a tweet under 280 characters
- Style: ${tone}
- Show progress, commitment, and accountability
- Include these hashtags at the end: ${allHashtags}
- Make it inspiring for others following similar challenges
- Show the daily grind and consistency

Examples:
- "Day 23/100 of #100DaysOfLeetCode ✅ Crushed 'Two Sum' and 'Valid Parentheses' today. The consistency is building momentum! 🚀 #leetcode #challenge #DevShare"
- "Daily grind complete! 💪 2 LeetCode problems + 3 GitHub commits. Small steps, big dreams 🎯 #100DaysOfCode #buildinpublic #DevShare"
- "Day 45/100 and still going strong! 🔥 Today's solve: 'Merge Intervals' (Medium). Each problem makes me sharper 🧠 #100DaysOfLeetCode #challenge #DevShare"
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: "You are a creative tweet generator for a developer documenting their coding challenge journey." },
      { role: "user", content: prompt }
    ],
    temperature: 0.8,
    max_tokens: 120,
  });

  const rawTweet = response.choices[0].message.content?.trim() || "";
  const cleanedTweet = rawTweet.replace(/^["']|["']$/g, "");

  return cleanedTweet || `Day ${dayNumber} of my coding challenge complete! 💪 Consistency breeds excellence. ${allHashtags}`;
}

export async function generateChallengeFailureTweet(data: {
  challengeTitle: string;
  dayNumber: number;
  challengeType: string;
  isStrict: boolean;
}): Promise<string> {
  const { challengeTitle, dayNumber, challengeType, isStrict } = data;

  const systemPrompt = `You are DevShare's AI tweet generator specializing in challenge failure announcements. DevShare is a platform that helps developers showcase their coding journey through automated social media posts.

BRAND VOICE & TONE:
- Authentic and honest - we don't sugarcoat failures
- Supportive yet accountable - failure is part of growth
- Motivational but realistic - emphasize comeback potential
- Community-focused - others can learn from this
- Professional but human - vulnerability builds connection
- Action-oriented - focus on what's next, not dwelling on failure

CONTEXT:
- This is a public accountability system
- The user enrolled in a strict challenge knowing the consequences
- Failure tweets serve as both accountability and motivation for others
- The community expects transparency and authenticity
- This isn't punishment - it's part of the growth journey

TARGET AUDIENCE:
- Fellow developers following similar challenges
- People considering joining DevShare challenges
- The user's professional network and coding community
- Potential employers who value consistency and accountability

PSYCHOLOGICAL APPROACH:
- Normalize failure as part of the learning process
- Create urgency for getting back on track
- Build empathy while maintaining accountability
- Inspire others to stay consistent by showing consequences
- Frame failure as temporary, not permanent

CONTENT STRATEGY:
- Use specific day numbers to show progress made before failure
- Acknowledge the challenge difficulty respectfully
- Include hope and comeback potential
- Reference the community and support system
- Maintain the user's dignity while being transparent`;

  const userPrompt = `Generate a challenge failure tweet for:

Challenge: ${challengeTitle}
Day Failed: ${dayNumber}
Challenge Type: ${challengeType}
Strict Mode: ${isStrict ? 'Yes - Auto-fail on miss' : 'No - Warning system'}

STRICT REQUIREMENTS:
- Must be under 280 characters
- Include day number and total challenge days
- Use appropriate hashtags: #100DaysOfLeetCode #challenge #DevShare #accountability
- Tone should be honest but not overly negative
- Include a comeback/restart message
- Use emojis strategically (not excessively)
- Make it relatable to other developers
- Show vulnerability but maintain professionalism

CONTENT ELEMENTS TO INCLUDE:
1. Clear acknowledgment of failure
2. Specific day number context
3. Take responsibility (no excuses)
4. Mention the comeback/restart possibility
5. Community accountability aspect
6. Learning/growth mindset

AVOID:
- Making excuses or blaming external factors
- Being overly dramatic or self-pitying
- Shaming or negative self-talk
- Generic motivational quotes
- Hiding from the failure

EXAMPLES OF GOOD FAILURE TWEETS:
- "Day 23/100 of #100DaysOfLeetCode - missed today's problem and the streak is broken 💔 The accountability is real! Time to restart and come back stronger. Consistency is hard but that's what makes it valuable 💪 #challenge #DevShare #accountability"

- "Failed my #100DaysOfLeetCode challenge on day 47/100 😤 No excuses - I didn't prioritize it today. The public accountability stings but it's exactly what I needed. Restarting tomorrow because growth happens in the restart, not the perfection 🚀 #challenge #DevShare"

- "Streak broken at day 34/100 💀 #100DaysOfLeetCode challenge failed but not forgotten. The system works - when you slip, you own it publicly. Already planning my comeback strategy. Sometimes falling is the best lesson in flying 🎯 #accountability #DevShare #challenge"

Generate a failure tweet that balances accountability with hope, maintains the user's dignity while being transparent, and motivates both the user and the community watching.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.7, // Lower temperature for more consistent, appropriate responses
    max_tokens: 100, // Shorter since tweets are limited
    presence_penalty: 0.3, // Encourage variety in expression
    frequency_penalty: 0.2 // Reduce repetitive phrases
  });

  const rawTweet = response.choices[0].message.content?.trim() || "";
  const cleanedTweet = rawTweet.replace(/^["']|["']$/g, "");

  // Fallback failure tweets based on challenge type
  const fallbackTweets = {
    '100_days_leetcode': `Day ${dayNumber}/100 of #100DaysOfLeetCode - streak broken 💔 The accountability is real! No excuses, just learning. Time to restart and build that consistency muscle stronger 💪 #challenge #DevShare #accountability`,
    'daily_leetcode_github': `Missed my daily coding targets today 😤 The public accountability hits different! Back tomorrow with renewed focus. Growth happens in the comeback, not the perfection 🚀 #100DaysOfCode #challenge #DevShare`,
    'default': `Challenge accountability check: missed today's targets 💔 That's why public commitment works - it stings when you slip. Already planning the comeback strategy 💪 #challenge #DevShare #accountability`
  };

  return cleanedTweet || fallbackTweets[challengeType as keyof typeof fallbackTweets] || fallbackTweets.default;
}

export async function getChallengeProgress(userId: string, userChallengeId: string, challengeTitle: string) {
  try {

    // // fetch challenge 
    // const { data: challenge, error: challengeError } = await supabase
    //   .from('challenges')
    //   .select('*')
    //   .eq('id', challengeId)
    //   .single();

    // if (challengeError || !challenge) {
    //   throw new Error('Challenge not found');
    // }

    // fetch user 
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('github_username, leetcode_username')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      throw new Error('User not found');
    }

    const { data: progress, error } = await supabase
      .from('user_challenges')
      .select('*')
      .eq('id', userChallengeId)
      .single();

    if (error || !progress) {
      throw new Error('Challenge progress not found');
    }

    const leetcodeMetrics = await getLeetCodeMetrics(user.leetcode_username);

    const last24HrsLeetCodeSubmissions = leetcodeMetrics.recentSubmissions.filter((submission) => {
      const submissionDate = new Date(submission.timestamp);
      return submissionDate >= new Date(Date.now() - 24 * 60 * 60 * 1000);
    });

    if (last24HrsLeetCodeSubmissions.length === 0) {
      // TODO: Handle Challenge failure case
      return { progress, last24HrsLeetCodeSubmissions: [] };
    }

    // add all last24HrsLeetCodeSubmissions & update progress in challenge-daily-progress table
    // create new insert in challenge_daily_progress table

    // find last progress entry in challenge_daily_progress table
    let day_number = 1;
    const { data: lastProgress, error: lastProgressError } = await supabase
      .from('challenge_daily_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('user_challenge_id', progress.id)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (lastProgressError || !lastProgress) {
      console.error('Error fetching last progress:', lastProgressError);
    } else {
      day_number = lastProgress.day_number + 1;
    }
     
    const { data: dailyProgress, error: progressError } = await supabase
      .from('challenge_daily_progress')
      .insert({
        user_id: userId,
        challenge_id: progress.challenge_id,
        user_challenge_id: progress.id,
        date: new Date().toISOString().split('T')[0],
        day_number,
        leetcode_submissions: last24HrsLeetCodeSubmissions.map(submission => ({
          title: submission.title,
          difficulty: submission.difficulty,
          timestamp: submission.timestamp
        }))
      })
      .select()
      .single();

    if (progressError || !dailyProgress) {
      console.error('Error inserting daily progress:', progressError);
      throw new Error('Failed to insert daily progress');
    }

    // now update the user_challenges table with the latest progress
    const { data: updatedChallenge, error: updateError } = await supabase
      .from('user_challenges')
      .update({
        total_days_completed: day_number,
        last_updated: new Date().toISOString(),
        current_streak: day_number // assuming current streak is equal to total days completed
      })
      .eq('id', progress.id)
      .select()
      .single();

    if (updateError || !updatedChallenge) {
      console.error('Error updating challenge:', updateError);
      throw new Error('Failed to update challenge');
    }


    return { challengeTitle, last24HrsLeetCodeSubmissions, day_number, challengeId: updatedChallenge.challenge_id, dailyProgressId: dailyProgress.id };
  } catch (error) {
    console.error('Error fetching challenge progress:', error);
    throw error;
  }
}
