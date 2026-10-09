-- Homepage promotions can now appear on the Casino, Live and Games lobbies.
-- Existing promotions keep showing on Casino only.
ALTER TABLE "home_promos" ADD COLUMN     "pages" TEXT[] DEFAULT ARRAY['casino']::TEXT[];
