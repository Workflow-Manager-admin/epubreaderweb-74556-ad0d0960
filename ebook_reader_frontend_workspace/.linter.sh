#!/bin/bash
cd /home/kavia/workspace/code-generation/epubreaderweb-74556-ad0d0960/ebook_reader_frontend_workspace/ebook_reader_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

