import { config } from '../config.js';

const STATUS_PAGE_PATH = '/diet-status.html';

/** Builds a Flex Message bubble listing a diet.js weight projection:
 * a summary header (total/monthly rate + realism badge) followed by one row
 * per date. `realism` is { emoji, color, label } from diet.js's rankRealism().
 * The badge is tappable (opens public/diet-status.html explaining the ranks)
 * when PUBLIC_BASE_URL is configured - LINE requires an absolute https URL,
 * so without it the badge is shown without a tap action. */
export function makeFlexDiet(totalRate, monthlyRate, realism) {
  const statusUrl = config.publicBaseUrl ? `${config.publicBaseUrl}${STATUS_PAGE_PATH}` : null;
  const bubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f766e',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: '📉 ダイエット試算', color: '#ffffff', weight: 'bold', size: 'md' },
        {
          type: 'text',
          text: `総率 ${totalRate.toFixed(2)}% 月率 ${monthlyRate.toFixed(2)}%/30日`,
          color: '#ccfbf1',
          size: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#f3f4f6',
          cornerRadius: 'md',
          paddingAll: 'sm',
          alignItems: 'center',
          action: statusUrl ? { type: 'uri', label: '詳しく', uri: statusUrl } : undefined,
          contents: [
            {
              type: 'box',
              layout: 'baseline',
              flex: 1,
              contents: [
                { type: 'text', text: realism.emoji, size: 'sm', flex: 0 },
                {
                  type: 'text',
                  text: realism.label,
                  color: realism.color,
                  weight: 'bold',
                  size: 'sm',
                  margin: 'sm',
                  wrap: true,
                },
              ],
            },
            ...(statusUrl
              ? [{ type: 'text', text: '詳しく ›', color: '#9ca3af', size: 'xxs', flex: 0, margin: 'sm' }]
              : []),
          ],
        },
        { type: 'separator', margin: 'md' },
      ],
    },
  };

  return {
    addRow(date, weight, { emphasis = false } = {}) {
      const color = emphasis ? '#0f766e' : '#333333';
      const weight_ = emphasis ? 'bold' : 'regular';
      bubble.body.contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: date, size: 'sm', flex: 3, color, weight: weight_ },
          { type: 'text', text: `${weight.toFixed(2)} kg`, size: 'sm', flex: 2, align: 'end', color, weight: weight_ },
        ],
      });
    },
    messages() {
      return [{ type: 'flex', altText: 'ダイエット試算', contents: bubble }];
    },
  };
}
