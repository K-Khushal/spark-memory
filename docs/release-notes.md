# Release notes

## First deploy

Migration `0020_video_sources.sql` re-indexes every existing YouTube/Vimeo link once. These rows run at background priority through the budget gate, so the one-off Indexing cost stays within the configured budget.
