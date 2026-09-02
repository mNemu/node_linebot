export function viewHelp() {
  return (
    'nDm  -> m面ダイスをn回振ります。\n' +
    '～から～  -> ～から～の経路検索を行います。\n' +
    'sch [view|set] -> スケジュールの[表示|設定]を行います。\n' +
    'alb [list|set|unset|url] -> アルバム(google driveへの保存)設定を行います。\n' +
    'diet 目標値 目標日 初期値 [開始日]\n' +
    'cfg [list|get|set] -> このトークの設定(Calendar/Folder/mail等)を管理します。\n'
  );
}
