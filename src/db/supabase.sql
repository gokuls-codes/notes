-- 1. Create the canvases table
CREATE TABLE IF NOT EXISTS public.canvases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT UNIQUE NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    content JSONB DEFAULT '{"strokes": [], "shapes": [], "texts": []}'::jsonb,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;

-- 3. Set up Policies

-- Allow anyone to read a canvas if it's marked as public
CREATE POLICY "Public canvases are viewable by everyone" 
ON public.canvases FOR SELECT 
USING (is_public = true);

-- Allow users to view their own private canvases
CREATE POLICY "Owners can view their own private canvases" 
ON public.canvases FOR SELECT 
USING (auth.uid() = owner_id);

-- Allow authenticated users to create a new canvas
CREATE POLICY "Authenticated users can create canvases" 
ON public.canvases FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Allow owners to update their own canvases (needed for saving changes)
CREATE POLICY "Owners can update their own canvases" 
ON public.canvases FOR UPDATE 
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Allow owners to delete their own canvases
CREATE POLICY "Owners can delete their own canvases" 
ON public.canvases FOR DELETE 
USING (auth.uid() = owner_id);

-- Add a name column for better organization
ALTER TABLE public.canvases ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Untitled Canvas';
