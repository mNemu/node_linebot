/** Builds a Flex Message bubble listing a diet.js weight projection:
 * a summary header (total/monthly rate) followed by one row per date. */
export function makeFlexDiet(totalRate, monthlyRate) {
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
      contents: [],
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
