// Small builder for the schedule Flex Message, ported as-is from LINE.gs's makeFlexSchedule().
export function makeFlexSchedule() {
  let idx = 0;
  const blankBubble = () => ({
    type: 'flex',
    altText: 'サブジェクト',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'box', layout: 'horizontal', contents: [] }],
      },
    },
  });

  const messages = [blankBubble()];

  return {
    next() {
      idx += 1;
      messages.push(blankBubble());
    },
    altText(text) {
      messages[idx].altText = text;
    },
    addSchedule(date, between, subject, actText) {
      messages[idx].contents.body.contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: date, size: 'sm', flex: 5 },
          { type: 'text', text: between, size: 'sm', flex: 2 },
          {
            type: 'text',
            text: subject,
            size: 'sm',
            flex: 5,
            color: '#800080',
            wrap: true,
            action: { type: 'message', text: actText },
          },
        ],
      });
    },
    addScheduleLink(date, between, subject, uri) {
      messages[idx].contents.body.contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: date, size: 'sm', flex: 5 },
          { type: 'text', text: between, size: 'sm', flex: 2 },
          {
            type: 'text',
            text: subject,
            size: 'sm',
            flex: 5,
            color: '#800080',
            wrap: true,
            action: { type: 'uri', label: 'detail', uri },
          },
        ],
      });
    },
    addMemo(memo) {
      messages[idx].contents.body.contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [{ type: 'text', text: memo, size: 'sm', wrap: true }],
      });
    },
    addLink(memo, link) {
      messages[idx].contents.body.contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: memo,
            color: '#800080',
            size: 'sm',
            wrap: true,
            action: { type: 'uri', label: 'memo', uri: link },
          },
        ],
      });
    },
    addSeparator() {
      messages[idx].contents.body.contents.push({ type: 'separator' });
    },
    messages() {
      return messages;
    },
  };
}
