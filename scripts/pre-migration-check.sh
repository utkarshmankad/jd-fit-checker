#!/bin/bash

echo ""
echo "══════════════════════════════════════"
echo "  jd-fit-checker MIGRATION CHECKLIST  "
echo "══════════════════════════════════════"
echo ""
echo "Confirm ALL of these before proceeding:"
echo ""
echo "[ ] 1. Migration file has a ROLLBACK section"
echo "[ ] 2. Migration tested on dev Supabase first"
echo "[ ] 3. Feature verified on dev.jobsnob.fyi"
echo "[ ] 4. You checked the Supabase project name/ref"
echo "       (top-left of Supabase dashboard)"
echo "[ ] 5. You read the full migration SQL"
echo "[ ] 6. supabase/schema.sql will be updated"
echo "       after this migration is applied"
echo ""
echo "Your environments:"
echo "  DEV  Supabase ref: avbufhugdkjmsypaifjx"
echo "  PROD Supabase ref: jbyowtffnhdvjnhzwest"
echo ""
echo "Type the target environment (dev/prod):"
read target

if [ "$target" = "dev" ]; then
  echo ""
  echo "✓ Applying to DEV."
  echo "  Open: Supabase dashboard → project ref avbufhugdkjmsypaifjx"
  echo "  → SQL Editor → paste migration → Run"
  echo "  Then test the affected feature on dev.jobsnob.fyi"
elif [ "$target" = "prod" ]; then
  echo ""
  echo "⚠️  Applying to PRODUCTION."
  echo "Type 'yes i am sure' to confirm:"
  read confirm
  if [ "$confirm" = "yes i am sure" ]; then
    echo ""
    echo "✓ Proceeding with PROD migration."
    echo "  Open: Supabase dashboard → project ref jbyowtffnhdvjnhzwest"
    echo "  → SQL Editor → paste migration → Run"
    echo "  Verify on jobsnob.fyi after applying."
  else
    echo "Cancelled."
    exit 1
  fi
else
  echo "Invalid input. Type 'dev' or 'prod'."
  exit 1
fi
