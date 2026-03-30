// Google Apps Script — ScrapeFlow 삭제 피드백 수신
// 사용법:
// 1. https://script.google.com 접속
// 2. 새 프로젝트 생성
// 3. 이 코드를 붙여넣기
// 4. 배포 → 새 배포 → 웹 앱 → 액세스: "모든 사용자" → 배포
// 5. 생성된 URL을 uninstall.html의 FEEDBACK_ENDPOINT에 붙여넣기

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    var sheet = getOrCreateSheet();

    // 행 추가: 타임스탬프, 이메일, 사유, 기타 텍스트, 추가 의견
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.email || '',
      translateReason(data.reason),
      data.otherText || '',
      data.comments || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET 요청 처리 (CORS preflight 대응)
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 시트 가져오기 또는 생성
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // 독립 실행 스크립트인 경우 새 스프레드시트 생성
    ss = SpreadsheetApp.create('ScrapeFlow 삭제 피드백');
  }
  var sheet = ss.getSheetByName('피드백');
  if (!sheet) {
    sheet = ss.insertSheet('피드백');
    // 헤더 추가
    sheet.appendRow(['타임스탬프', '이메일', '삭제 사유', '기타 사유', '추가 의견']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 사유 코드 → 한국어 변환
function translateReason(reason) {
  var map = {
    'too_complicated': '너무 복잡함',
    'cannot_sign_in': '로그인 불가',
    'not_useful': '유용하지 않음',
    'browser_issue': '브라우저 호환 문제',
    'other': '기타'
  };
  return map[reason] || reason || '';
}
