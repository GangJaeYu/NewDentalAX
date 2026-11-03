-- 이 파일이 하는 일: 품목(items)에 바코드 값 칸을 더한다(FR-130, phase-06-task-01).
-- 바코드는 글자로 둔다(EAN-13 앞자리 0이 사라지지 않게). 비워 둘 수 있고, 값이 있으면 이 병원(DB) 안에서 겹치지 않는다(부분 고유 색인).
-- 같은 값인지 비교할 때는 앞뒤 공백을 뺀 그대로 본다(서비스가 저장 전에 공백을 지운다). 환자 관련 열은 두지 않는다(NFR-001).

ALTER TABLE items ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX idx_items_barcode ON items (barcode) WHERE barcode IS NOT NULL;
