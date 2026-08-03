/**
 * 두암한방병원 — 홈페이지 진료 문의 접수 스크립트
 *
 * 홈페이지 문의 폼에서 보낸 내용을 구글 시트에 한 줄씩 쌓고,
 * 지정한 이메일로 알림을 보냅니다.
 *
 * ── 설정에서 바꿔야 하는 것은 아래 NOTIFY_EMAIL 한 줄뿐입니다 ──
 */

// 문의 알림을 받을 이메일 주소. 여러 개면 쉼표로 구분: 'a@b.com, c@d.com'
var NOTIFY_EMAIL = '여기에_병원_이메일주소@example.com';

// 시트 탭 이름 (그대로 두시면 됩니다)
var SHEET_NAME = '문의접수';


function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};

    // 스팸 봇 차단 (사람에게는 안 보이는 칸이 채워져 있으면 무시)
    if (p._gotcha) {
      return json({ result: 'success' });
    }

    var name  = String(p.name  || '').trim();
    var phone = String(p.phone || '').trim();
    var when  = String(p.when  || '').trim();
    var agree = String(p.agree || '').trim();

    if (!name || !phone) {
      return json({ result: 'error', message: '필수 항목 누락' });
    }
    if (!agree) {
      return json({ result: 'error', message: '개인정보 동의 필요' });
    }

    var sheet = getSheet_();
    var now = new Date();

    sheet.appendRow([
      now,                    // 접수 일시
      name,                   // 성함
      "'" + phone,            // 연락처 (앞에 ' 를 붙여야 010-... 이 날짜로 안 바뀝니다)
      when || '아무 때나',      // 전화 받기 편한 시간
      agree,                  // 개인정보 동의
      '접수'                   // 처리 상태 (병원에서 직접 '완료' 등으로 바꿔 쓰세요)
    ]);

    notify_(name, phone, when, now);

    return json({ result: 'success' });

  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}


// 브라우저에서 배포 주소를 그냥 열었을 때 동작 확인용
function doGet() {
  return json({ result: 'ok', message: '두암한방병원 문의 접수 스크립트가 작동 중입니다.' });
}


/** 시트를 찾고, 없으면 머리글과 함께 새로 만듭니다. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['접수 일시', '성함', '연락처', '전화 받기 편한 시간', '개인정보 동의', '처리 상태']);
    var head = sheet.getRange(1, 1, 1, 6);
    head.setFontWeight('bold').setBackground('#E8F4FB');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 140);
    sheet.setColumnWidth(4, 170);
    sheet.setColumnWidth(5, 110);
    sheet.setColumnWidth(6, 100);
  }

  return sheet;
}


/** 병원 이메일로 알림을 보냅니다. 실패해도 접수 자체는 정상 처리됩니다. */
function notify_(name, phone, when, now) {
  if (!NOTIFY_EMAIL || NOTIFY_EMAIL.indexOf('여기에') === 0) return;

  var stamp = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy년 M월 d일 (E) HH:mm');
  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  var body =
    '홈페이지로 전화 상담 요청이 들어왔습니다.\n\n' +
    '───────────────────────\n' +
    '  성함        : ' + name + '\n' +
    '  연락처      : ' + phone + '\n' +
    '  편한 시간   : ' + (when || '아무 때나') + '\n' +
    '  접수 일시   : ' + stamp + '\n' +
    '───────────────────────\n\n' +
    '전체 접수 내역 보기:\n' + sheetUrl + '\n';

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: '[두암한방병원] 전화 상담 요청 — ' + name + ' 님 (' + phone + ')',
      body: body
    });
  } catch (err) {
    // 메일 실패는 무시 — 시트에는 이미 저장되어 있습니다.
  }
}


function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
