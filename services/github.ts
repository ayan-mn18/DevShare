import { ApiError } from '../middleware/errorHandler';
import type { GithubMetrics } from '../types/api';
import dotenv from 'dotenv';

dotenv.config();

const GITHUB_API_URL = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;

export async function validateGithubUsername(username: string): Promise<boolean> {
  try {
    const response = await fetch(`${GITHUB_API_URL}/users/${username}`);
    console.log('Response of validation for github username:', response.statusText);
    return response.ok;
  } catch (error) {
    return false;
  }
}

export async function getGithubMetrics(username: string, worker: boolean): Promise<GithubMetrics> {
  try {
    const query = `
query($userName:String!) {
  user(login: $userName){
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}
`
const variables = `
  {
    "userName": "${username}"
  }
`
  const body = {
    query,
    variables
  }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body)
  });
  const response = await res.json();
  const weeks = response.data.user.contributionsCollection.contributionCalendar.weeks;

  // Flatten all days into a single array
  const allDays = weeks.flatMap((week: any) => week.contributionDays);

  // Sort by date descending (just in case)
  allDays.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Get the last 12 days (most recent)
  let last12Days = []; // reverse to get chronological order

  if(worker) {
    // Reverse to get chronological order if this is for worker
    last12Days = allDays.slice(1, 13);
  } else {
    last12Days = allDays.slice(0, 12);
  }

  console.log('Response of github metrics:', JSON.stringify(last12Days, null, 2));

  // Total contributions
    const totalContributions = last12Days.reduce((sum: number, day: any) => sum + day.contributionCount, 0);

    // Max streak calculation
    let maxStreak = 0;
    let currentStreak = 0;
    for (const day of last12Days) {
      if (day.contributionCount > 0) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

  const followersResponse = await fetch(`${GITHUB_API_URL}/users/${username}`);
    const followersData = await followersResponse.json();
    const followers = followersData.followers;

  return {
    contributions: last12Days.map((day: any) => ({
      date: day.date,
      count: day.contributionCount
    })),
    totalCommits: totalContributions,
    streak: maxStreak,
    followers
  };

  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch GitHub metrics');
  }
}