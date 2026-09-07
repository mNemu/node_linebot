/** "メニュー" フレックスメッセージ: public/liff/index.html のトップページ相当の
 * 機能一覧を、LINEのトーク内でそのままタップできる形で返す。
 * サイコロ/ダイエット試算/得点記録ページの各フレックスメッセージのヘッダー
 * 右上に置く「⋮」ボタン(menuHeaderButton)から呼び出される想定で、
 * ボタンは「@BOT メニュー」を送信した体のメッセージアクションになっている
 * (selecter.js がそのテキストを受けて makeFlexMenu() を返す)。 */
import { config } from '../config.js';

const ITEMS = [
  { icon: '🎲', label: 'サイコロ', color: '#5b21b6', href: (liffId) => `https://liff.line.me/${liffId}?view=dice` },
  { icon: '⚖️', label: 'ダイエット試算', color: '#0f766e', href: (liffId) => `https://liff.line.me/${liffId}?view=diet` },
  { icon: '⏱️', label: 'タイマー', color: '#334155', href: (liffId) => `https://liff.line.me/${liffId}/timer/` },
  { icon: '🎯', label: 'モルック', color: '#b45309', href: (liffId) => `https://liff.line.me/${liffId}/molkky/` },
  { icon: '⛳', label: 'ゴルフ', color: '#15803d', href: (liffId) => `https://liff.line.me/${liffId}/golf/` },
  { icon: '📊', label: '得点ボード', color: '#4338ca', href: (liffId) => `https://liff.line.me/${liffId}/scoreboard/` },
];

/** フレックスメッセージのヘッダー右上に置く「⋮」メニューボタン。タップ
 * すると「@BOT メニュー」を送信した体になる(選択・確定操作を挟まないので
 * ユーザー操作としては見えるが、実際に打鍵させるより手軽)。 */
export function menuHeaderButton(color = '#ffffff') {
  return {
    type: 'box',
    layout: 'vertical',
    width: '32px',
    height: '32px',
    justifyContent: 'center',
    alignItems: 'center',
    flex: 0,
    action: { type: 'message', label: 'メニュー', text: '@BOT メニュー' },
    contents: [{ type: 'text', text: '⋮', color, size: 'xl', weight: 'bold', align: 'center' }],
  };
}

/** LIFFのトップページ相当の機能一覧を Flex Message で返す。LIFF_ID が
 * 未設定の環境ではリンクを開けないため、案内テキストにフォールバックする。 */
export function makeFlexMenu() {
  const liffId = config.liffId;
  if (!liffId) {
    return 'メニューを使うには LIFF_ID の設定が必要です。';
  }
  const bubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1f2937',
      paddingAll: 'md',
      contents: [{ type: 'text', text: '📋 メニュー', color: '#ffffff', weight: 'bold', size: 'lg' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: ITEMS.map((item) => ({
        type: 'box',
        layout: 'horizontal',
        backgroundColor: item.color,
        cornerRadius: 'md',
        paddingAll: 'md',
        alignItems: 'center',
        action: { type: 'uri', label: item.label, uri: item.href(liffId) },
        contents: [
          { type: 'text', text: item.icon, size: 'md', flex: 0 },
          { type: 'text', text: item.label, color: '#ffffff', weight: 'bold', size: 'sm', margin: 'sm', flex: 1 },
          { type: 'text', text: '›', color: '#ffffff', size: 'md', flex: 0 },
        ],
      })),
    },
  };
  return [{ type: 'flex', altText: '📋 メニュー', contents: bubble }];
}
