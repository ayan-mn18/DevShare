// services/email.ts
import { Resend } from 'resend';
import { supabase } from '../lib/supabase';
import { 
  loadTemplate, 
  renderTemplate, 
  getChallengeRequirements, 
  formatRequirementsList,
  getWarningSection 
} from '../email/templates';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'DevShare <noreply@devshare.ayanmn18.live>';

interface EnrollmentData {
  id: string;
  user_id: string;
  challenge_id: string;
  start_date: string;
  end_date: string;
  challenge?: {
    title: string;
    description: string;
    duration_days: number;
    type: string;
  };
}

export async function sendEnrollmentEmail(email: string, enrollment: EnrollmentData) {
  try {
    let { challenge } = enrollment;
    if (!challenge) {
      const { data: challengeData, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', enrollment.challenge_id)
        .single();

      if (error || !challengeData) {
        throw new Error('Failed to fetch challenge details');
      }

      enrollment.challenge = challengeData;
      challenge = challengeData;
    }

    // Format dates
    const formattedStartDate = new Date(enrollment.start_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const formattedEndDate = new Date(enrollment.end_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Load and render template
    const templateContent = loadTemplate('enrollment');
    // @ts-ignore
    const isStrictChallenge = challenge.type === '100_days_leetcode';
    // @ts-ignore
    const requirements = getChallengeRequirements(challenge.type);
    
    const emailHtml = renderTemplate(templateContent, {
      // @ts-ignore
      challengeTitle: challenge.title,
      // @ts-ignore
      challengeDescription: challenge.description,
      // @ts-ignore
      duration: challenge.duration_days,
      formattedStartDate,
      formattedEndDate,
      requirementsList: formatRequirementsList(requirements),
      warningSection: getWarningSection(isStrictChallenge)
    });

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      // @ts-ignore
      subject: `🚀 Challenge Enrollment Confirmed - ${challenge.title}`,
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending enrollment email:', error);
      throw error;
    }

    console.log('Enrollment email sent successfully:', data);
    return data;
  } catch (error) {
    console.error('Failed to send enrollment email:', error);
    throw error;
  }
}

export async function sendChallengeReminderEmail(email: string, challengeData: any) {
  try {
    const templateContent = loadTemplate('reminder');
    const emailHtml = renderTemplate(templateContent, challengeData);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: `⏰ Daily Challenge Reminder - Don't break your streak!`,
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending reminder email:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to send reminder email:', error);
    throw error;
  }
}

export async function sendChallengeFailureEmail(email: string, challengeData: any) {
  try {
    const templateContent = loadTemplate('failure');
    const emailHtml = renderTemplate(templateContent, challengeData);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: `💔 Challenge Failed - But You Can Try Again!`,
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending failure email:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to send failure email:', error);
    throw error;
  }
}

export async function sendMarketingEmail(email: string, userData?: any) {
  try {
    const templateContent = loadTemplate('marketing');
    const userName = userData?.name || 'Developer';
    
    const emailHtml = renderTemplate(templateContent, {
      userName
    });

    const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: [email],
        subject: `🚀 Turn Your Coding Journey Into Your Personal Brand - DevShare`,
        html: emailHtml,
    });

    if (error) {
      console.error('Error sending marketing email:', error);
      throw error;
    }

    console.log('Marketing email sent successfully:', data);
    return data;
  } catch (error) {
    console.error('Failed to send marketing email:', error);
    throw error;
  }
}

export async function sendWelcomeSeriesEmail(email: string, seriesStep: number, userData?: any) {
  try {
    const templateContent = loadTemplate('welcome');
    const userName = userData?.name || 'Developer';
    
    const subjects = [
      "🎉 Welcome to DevShare - Let's automate your coding success!",
      "⚡ Quick Setup Guide: Connect your accounts in 2 minutes",
      "🚀 Your first auto-tweet goes live tomorrow!",
      "💡 Pro Tips: Maximize your developer brand with DevShare"
    ];

    const emailHtml = renderTemplate(templateContent, {
      userName
    });

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: subjects[seriesStep - 1] || subjects[0],
      html: emailHtml,
    });

    if (error) {
      console.error('Error sending welcome series email:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to send welcome series email:', error);
    throw error;
  }
}