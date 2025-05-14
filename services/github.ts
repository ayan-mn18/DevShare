import { ApiError } from '../middleware/errorHandler';
import type { GithubMetrics } from '../types/api';

const GITHUB_API_URL = 'https://api.github.com';

export async function validateGithubUsername(username: string): Promise<boolean> {
  try {
    const response = await fetch(`${GITHUB_API_URL}/users/${username}`);
    console.log('Response of validation for github username:', response.statusText);
    return response.ok;
  } catch (error) {
    return false;
  }
}

export async function getGithubMetrics(username: string): Promise<GithubMetrics> {
  try {

    const response = await fetch(`${GITHUB_API_URL}/users/${username}/events`);

    if (!response.ok) {
      throw new ApiError(404, 'GitHub user not found');
    }

    const events = await response.json();

    const contributions = events.filter((event: any) => event.type === 'PushEvent');
    const totalCommits = contributions.reduce((sum: number, event: any) => sum + event.payload.size, 0);
    const followersResponse = await fetch(`${GITHUB_API_URL}/users/${username}`);
    const followersData = await followersResponse.json();
    const followers = followersData.followers;

    // calculate contributions in the last 12 days
    // return an array of objects with date and count
    // so first create an array with the last 12 dates, and then map the contributions to that array, keep only 12 elements and there is a possibility that there are no contributions in a day, so set the count to 0
    const today = new Date();
    const contributionsArray = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateString = date.toISOString().split('T')[0];
      const count = contributions.filter((event: any) => {
        const eventDate = new Date(event.created_at);
        return eventDate.toISOString().split('T')[0] === dateString;
      }).reduce((sum: number, event: any) => sum + event.payload.size, 0);
      return { date: dateString, count };
    });
    // contributionsArray.reverse();

    // calculate the biggest streak of last 12 days
    let streak = 0;
    let currentStreak = 0;
    for (let i = 0; i < contributionsArray.length; i++) {
      if (contributionsArray[i].count > 0) {
        currentStreak++;
      } else {
        if (currentStreak > streak) {
          streak = currentStreak;
        }
        currentStreak = 0;
      }
    }
    if (currentStreak > streak) {
      streak = currentStreak;
    }
    console.log('Streak:', streak);
    

    return {
      contributions: contributionsArray,
      totalCommits,
      streak,
      followers
    };

  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch GitHub metrics');
  }
}