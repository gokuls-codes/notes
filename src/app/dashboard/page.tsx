'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import Link from 'next/link';
import { LayoutDashboard, Plus, Clock, Globe, Lock, ArrowLeft, Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

type Canvas = {
  id: string;
  room_id: string;
  name: string;
  is_public: boolean;
  updated_at: string;
  content: unknown;
};

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        router.push('/');
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    const fetchCanvases = async () => {
      if (!user) return;
      setIsLoading(true);
      const { data, error } = await supabase
        .from('canvases')
        .select('*')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

      if (data && !error) {
        setCanvases(data);
      }
      setIsLoading(false);
    };

    if (user) {
      fetchCanvases();
    }
  }, [user]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const createNewBoard = () => {
    const newRoomId = Math.random().toString(36).substring(2, 12);
    router.push(`/?room=${newRoomId}`);
  };

  if (!user && !isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-500 mb-6">
          <Lock size={32} />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Authentication Required</h1>
        <p className="text-zinc-400 max-w-sm mb-8">Please sign in from the drawing board to view your saved canvases.</p>
        <Link href="/" className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2">
          <ArrowLeft size={18} /> Back to Board
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-indigo-500/30">
      <nav className="border-b border-zinc-800/50 bg-zinc-950/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center">
              <img src="/icon.png" alt="Logo" className="w-8 h-8 object-contain" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Your Canvases</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="px-4 py-2 hover:bg-zinc-800/50 text-zinc-400 hover:text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
            >
              <ArrowLeft size={16} /> Back
            </Link>
            <button 
              onClick={createNewBoard}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-all shadow-lg shadow-indigo-500/20 text-sm font-medium flex items-center gap-2 active:scale-95"
            >
              <Plus size={16} /> New Canvas
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 size={32} className="text-indigo-500 animate-spin" />
            <p className="text-zinc-500 font-medium">Loading your canvases...</p>
          </div>
        ) : canvases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-zinc-900 ring-1 ring-zinc-800 rounded-2xl flex items-center justify-center mb-6 shadow-2xl">
              <img src="/icon.png" alt="Logo" className="w-10 h-10 object-contain opacity-50 grayscale" />
            </div>
            <h2 className="text-2xl font-bold mb-2">No canvases yet</h2>
            <p className="text-zinc-500 max-w-sm mb-8">You haven&apos;t saved any canvases to the cloud. Create one and click the save button.</p>
            <button 
              onClick={createNewBoard}
              className="px-6 py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-xl transition-all shadow-xl active:scale-95 flex items-center gap-2"
            >
              <Plus size={18} /> Create First Canvas
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {canvases.map((canvas) => (
              <div 
                key={canvas.id} 
                className="group relative bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl overflow-hidden transition-all hover:shadow-2xl hover:shadow-black/50"
              >
                <div className="aspect-4/3 bg-zinc-950 p-4 relative overflow-hidden flex items-center justify-center">
                  {/* Subtle placeholder rendering of strokes/shapes could go here, for now it's abstract art representation */}
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.1),transparent_70%)] group-hover:opacity-40 transition-opacity duration-500" />
                  
                  <div className="relative z-10 w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 shadow-xl flex items-center justify-center text-zinc-600 group-hover:scale-110 group-hover:text-indigo-400 group-hover:bg-zinc-800 group-hover:border-zinc-700 transition-all duration-300">
                     <Play size={24} className="ml-1" />
                  </div>
                  
                  <div className="absolute top-3 right-3 flex items-center justify-center px-2.5 py-1 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-full text-[10px] font-bold uppercase tracking-wider text-zinc-400 gap-1.5 shadow-lg">
                    {canvas.is_public ? (
                      <><Globe size={10} className="text-emerald-400" /> Public</>
                    ) : (
                      <><Lock size={10} className="text-rose-400" /> Private</>
                    )}
                  </div>
                </div>
                
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-white mb-2 line-clamp-1 group-hover:text-indigo-300 transition-colors">
                    {canvas.name || 'Untitled Canvas'}
                  </h3>
                  <div className="flex items-center text-sm text-zinc-500 gap-2">
                    <Clock size={14} />
                    <span>Updated {formatDate(canvas.updated_at)}</span>
                  </div>
                </div>
                
                <Link 
                  href={`/?room=${canvas.room_id}`}
                  className="absolute inset-0 z-20"
                  aria-label={`Open ${canvas.name || 'Untitled Canvas'}`}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
