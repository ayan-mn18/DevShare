// services/email/templates/index.ts
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = path.join(__dirname);

export function loadTemplate(templateName: string): string {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  return fs.readFileSync(templatePath, 'utf-8');
}

export function renderTemplate(templateContent: string, data: Record<string, any>): string {
  let rendered = templateContent;
  
  // Replace template variables
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, data[key] || '');
  });
  
  return rendered;
}

export function getChallengeRequirements(challengeType: string): string[] {
  switch (challengeType) {
    case '100_days_leetcode':
      return [
        'Solve at least 1 LeetCode problem every day',
        'Problems must be solved within 24 hours',
        'Progress automatically tracked and tweeted',
        'No rest days allowed - strict consistency required'
      ];
    
    case 'daily_leetcode_github':
      return [
        'Solve at least 1 LeetCode problem daily',
        'Make at least 1 GitHub commit daily',
        'Both requirements must be met each day',
        'Progress automatically shared on Twitter'
      ];
    
    default:
      return [
        'Complete daily coding activities',
        'Maintain consistent progress',
        'Share achievements automatically'
      ];
  }
}

export function formatRequirementsList(requirements: string[]): string {
  return requirements
    .map(req => `<div class="requirement-item">${req}</div>`)
    .join('');
}

export function getWarningSection(isStrict: boolean): string {
  if (!isStrict) return '';
  
  return `
    <div class="warning-box">
        <div class="warning-title">Strict Challenge Rules</div>
        <div class="warning-text">
            This is a <strong>strict consistency challenge</strong>. Missing even one day will result in:
            <br><br>
            • Automatic failure tweet posted to your account<br>
            • Challenge marked as failed<br>
            • You can re-enroll after failure<br>
            <br>
            <strong>Stay consistent - your accountability is public! 🎯</strong>
        </div>
    </div>
  `;
}