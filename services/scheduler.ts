import { Job } from 'bullmq';
import { getGithubMetrics } from './github';
import { getLeetCodeMetrics } from './leetcode';
import { postTweet } from './twitter';
import { supabase } from '../lib/supabase';
import { openai } from './openai';

interface TweetJobData {
  userId: string;
  botId: string;
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


