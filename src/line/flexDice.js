const DICE_PER_ROW = 8;

/** Builds a Flex Message bubble showing each die's result as a small tile,
 * plus the total. `results` is an array of individual die values. */
export function makeFlexDice(count, sides, results, sum) {
  const rows = [];
  for (let i = 0; i < results.length; i += DICE_PER_ROW) {
    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: results.slice(i, i + DICE_PER_ROW).map((d) => ({
        type: 'box',
        layout: 'vertical',
        width: '36px',
        height: '36px',
        backgroundColor: '#ede9fe',
        cornerRadius: 'md',
        justifyContent: 'center',
        alignItems: 'center',
        contents: [{ type: 'text', text: String(d), size: 'sm', weight: 'bold', color: '#5b21b6', align: 'center' }],
      })),
    });
  }

  const bubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#5b21b6',
      paddingAll: 'md',
      contents: [{ type: 'text', text: `🎲 ${count}D${sides}`, color: '#ffffff', weight: 'bold', size: 'lg' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        ...rows,
        { type: 'separator' },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '合計', size: 'md', color: '#666666', gravity: 'center' },
            { type: 'text', text: String(sum), size: 'xxl', weight: 'bold', align: 'end', color: '#5b21b6' },
          ],
        },
      ],
    },
  };

  return [{ type: 'flex', altText: `🎲 ${count}D${sides} 合計${sum}`, contents: bubble }];
}
