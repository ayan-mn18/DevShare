export interface ApiResponse<T = unknown> {
  status: 'SUCCESS' | 'FAILURE';
  message: string;
  data: T | null;
}

export interface User {
  id: string;
  email: string | null;
  twitter_username: string | null;
  leetcode_username: string | null;
  github_username: string | null;
  test_tweet_used: boolean;
  created_at: string;
}

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  created_at: string;
}

export interface Tweet {
  id: string;
  bot_id: string;
  content: string;
  schedule_time: string;
  status: string;
  leetcode_contribution: number;
  github_contribution: number;
  created_at: string;
}

export interface GithubMetrics {
  contributions: GithubContribution[];
  totalCommits: number;
  streak: number;
  followers: number;
}

export interface GithubContribution {
  date: string;
  count: number;
}

export interface LeetCodeMetrics {
  totalSolved: number;
  streak: number;
  recentSubmissions: {
    title: string;
    difficulty: string;
    timestamp: string;
  }[];
  contestRating: number;
  level: string;
  totalQuestions: number;
}

export interface DashboardData {
  user: User;
  githubMetrics: GithubMetrics;
  leetCodeMetrics: LeetCodeMetrics;
}