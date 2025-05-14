import { ApiError } from '../middleware/errorHandler';
import type { LeetCodeMetrics } from '../types/api';
import axios from 'axios';

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';

export async function validateLeetCodeUsername(username: string): Promise<boolean> {
  try {
    const query = {
      query: `
        query userPublicProfile($username: String!) {
          matchedUser(username: $username) {
            username
          }
        }
      `,
      variables: {
        username
      }
    };
    
    const response = await axios.post(LEETCODE_GRAPHQL_URL, query);
    return !!response.data.data.matchedUser;
  } catch (error) {
    console.error('Error validating LeetCode username:', error);
    return false;
  }
}

export async function getLeetCodeMetrics(username: string): Promise<LeetCodeMetrics> {
  try {
    const profileQuery = {
      query: `
       query userProfileAndContestInfo($username: String!) {
          matchedUser(username: $username) {
            username
            submitStats: submitStatsGlobal {
              acSubmissionNum {
                difficulty
                count
              }
              totalSubmissionNum {
                difficulty
                count
              }
            }
            profile {
              ranking
              reputation
              starRating
            }
            submissionCalendar
            badges {
              id
              displayName
              icon
            }
              }
          allQuestionsCount {
            difficulty
            count
          }
        }
      `,
      variables: {
        username
      }
    };

    // Second query: Get recent submissions
    const submissionsQuery = {
      query: `
        query recentSubmissions($username: String!, $limit: Int) {
          recentSubmissionList(username: $username, limit: $limit) {
            title
            titleSlug
            timestamp
            statusDisplay
            lang
          }
        }
      `,
      variables: {
        username,
        limit: 10
      }
    };
    
    // Execute both queries in parallel
    const [profileResponse, submissionsResponse] = await Promise.all([
      axios.post(LEETCODE_GRAPHQL_URL, profileQuery, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Origin': 'https://leetcode.com',
          'Referer': 'https://leetcode.com/'
        }
      }),
      axios.post(LEETCODE_GRAPHQL_URL, submissionsQuery, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Origin': 'https://leetcode.com',
          'Referer': 'https://leetcode.com/'
        }
      })
    ]);
    const userData = profileResponse.data.data.matchedUser;
    if (!userData) {
      throw new ApiError(404, 'LeetCode user not found');
    }

    const allQuestionsCount = profileResponse.data.data.allQuestionsCount;
    const recentSubmissions = submissionsResponse.data.data.recentSubmissionList || [];
    
   

    // Parse submission calendar for streak calculation
    let streak = 0;
    if (userData.submissionCalendar) {
      try {
        const calendar = JSON.parse(userData.submissionCalendar);
        const timestamps = Object.keys(calendar).map(Number).sort((a, b) => b - a);
        const today = Math.floor(Date.now() / 1000 / 86400) * 86400;
        
        if (timestamps.length > 0) {
          const hasRecentSubmission = timestamps[0] >= today - 86400;
          
          if (hasRecentSubmission) {
            streak = 1;
            let prevDay = Math.floor(timestamps[0] / 86400) * 86400;
            
            for (let i = 1; i < timestamps.length; i++) {
              const currDay = Math.floor(timestamps[i] / 86400) * 86400;
              if (currDay === prevDay - 86400) {
                streak++;
                prevDay = currDay;
              } else if (currDay < prevDay - 86400) {
                break;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error parsing submission calendar:', err);
      }
    }

    let totalSolved = userData.submitStats.acSubmissionNum
      .reduce((total, item) => total + item.count, 0);
    let totalQuestions = allQuestionsCount
      .reduce((total, item) => total + item.count, 0);


    
    // Transform the GraphQL response to your API format
    return {
      totalSolved: totalSolved / 2,
      totalQuestions: totalQuestions / 2,
      streak,
      recentSubmissions: recentSubmissions
        .filter(sub => sub.statusDisplay === 'Accepted')
        .map(sub => ({
          title: sub.title,
          difficulty: 'Medium', // API doesn't return difficulty for submissions
          timestamp: new Date(sub.timestamp * 1000).toISOString()
        })),
      level: userData.badges?.[0]?.displayName || 'Novice',
      contestRating: userData.profile.ranking,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Error fetching LeetCode metrics:', error.response?.data || error.message);
    throw new ApiError(500, 'Failed to fetch LeetCode metrics');
  
  }
}