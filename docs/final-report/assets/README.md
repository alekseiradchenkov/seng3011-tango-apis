# Final Report Assets

Place the following image files in this folder so `Final_Report.md` can be exported to PDF with pandoc.

Required filenames (match exactly):

- `architecture.png`
  - Source: your Confluence "Final Report" architecture diagram (export as PNG).
- `seq_uc1_dataset_ingest.png`
  - Sequence for UC1: create dataset + ingest OHLC + derived events.
- `seq_uc2_visualise.png`
  - Sequence for UC2: retrieval + stats/export + chart rendering.
- `seq_uc3_predict.png`
  - Sequence for UC3/UC4: train model + predict + Mango/GridX.
- `ui_overview.png`
  - 1-page collage or annotated screenshots of the UI (login, datasets, dataset detail, predictive panel).
- `data_model.png`
  - Data model diagram showing DynamoDB keys and S3 object layout.
- `deployment.png`
  - Deployment diagram showing LocalStack flow and AWS dev/prod CI deploy flow.

Notes:

- Use PNG for consistent rendering in PDF export.
- If you prefer multiple UI screenshots, replace `ui_overview.png` with a single combined image to keep the PDF clean.
