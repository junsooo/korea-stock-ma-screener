# 한국 주식 이동평균선 전환 검색기

GitHub Pages용 정적 웹사이트입니다. GitHub Actions가 네이버 금융 데이터를 주기적으로 수집해 `data/stock-data.json`을 만들고, 브라우저는 이 파일을 읽어서 이동평균선 전환 조건을 계산합니다.

GitHub Pages 배포 후에는 저장소의 Actions 탭에서 `Update stock screener` 워크플로우가 실행되며, 그 과정에서 전체 종목 데이터가 생성됩니다.

로컬 서버로 테스트하려면 `start_stock_site.bat`를 실행한 뒤 `http://127.0.0.1:8787`로 접속합니다.
