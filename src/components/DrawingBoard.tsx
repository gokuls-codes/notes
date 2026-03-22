'use client';

import { useEffect, useState, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import { supabase } from '@/lib/supabase';
import { Trash2 } from 'lucide-react';

type Point = [number, number, number]; // [x, y, pressure]
type Stroke = Point[];

function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

export default function DrawingBoard() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke>([]);
  const [liveUsers, setLiveUsers] = useState<Record<string, Stroke>>({});
  const isDrawing = useRef(false);
  const lastSendTime = useRef(0);
  
  const [myUserId] = useState(() => Math.random().toString(36).substring(7));
  
  const roomRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase.channel('drawing-room', {
      config: { broadcast: { ack: false } }
    });
    
    roomRef.current = channel;

    channel
      .on('broadcast', { event: 'draw' }, ({ payload }) => {
        if (payload.type === 'move') {
          setLiveUsers(prev => ({
            ...prev,
            [payload.userId]: payload.stroke
          }));
        } else if (payload.type === 'end') {
          setLiveUsers(prev => {
            const newLive = { ...prev };
            const completedStroke = newLive[payload.userId];
            if (completedStroke) {
              setStrokes(s => [...s, completedStroke]);
            }
            delete newLive[payload.userId];
            return newLive;
          });
        } else if (payload.type === 'clear') {
          setStrokes([]);
          setLiveUsers({});
        }
      })
      .subscribe((status) => {
        console.log('Supabase status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
      roomRef.current = null;
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const point: Point = [e.clientX, e.clientY, e.pressure];
    setCurrentStroke([point]);
    
    roomRef.current?.send({
      type: 'broadcast',
      event: 'draw',
      payload: { type: 'move', userId: myUserId, stroke: [point] }
    });
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!isDrawing.current) return;
    const point: Point = [e.clientX, e.clientY, e.pressure];
    
    setCurrentStroke(prev => {
      const newStroke = [...prev, point];
      
      const now = Date.now();
      if (now - lastSendTime.current > 50) {
        roomRef.current?.send({
          type: 'broadcast',
          event: 'draw',
          payload: { type: 'move', userId: myUserId, stroke: newStroke }
        });
        lastSendTime.current = now;
      }
      return newStroke;
    });
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (!isDrawing.current) return;
    isDrawing.current = false;
    
    setStrokes(prev => [...prev, currentStroke]);
    setCurrentStroke([]);
    
    roomRef.current?.send({
      type: 'broadcast',
      event: 'draw',
      payload: { type: 'end', userId: myUserId }
    });
  }

  function clearBoard() {
    setStrokes([]);
    roomRef.current?.send({
      type: 'broadcast',
      event: 'draw',
      payload: { type: 'clear' }
    });
  }

  const strokeOptions = { size: 8, thinning: 0.5, smoothing: 0.5, streamline: 0.5 };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-900 touch-none">
      {/* Toolbar */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-white dark:bg-zinc-800 p-2 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700">
        <button 
          onClick={clearBoard}
          className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-300"
          title="Clear Board"
        >
          <Trash2 size={24} />
        </button>
      </div>

      <svg
        className="w-full h-full cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Render committed strokes */}
        {strokes.map((stroke, i) => (
          <path
            key={`stroke-${i}`}
            d={getSvgPathFromStroke(getStroke(stroke, strokeOptions))}
            className="fill-zinc-800 dark:fill-zinc-200"
          />
        ))}

        {/* Render live remote strokes in blue */}
        {Object.entries(liveUsers).map(([userId, stroke]) => (
          <path
            key={`live-${userId}`}
            d={getSvgPathFromStroke(getStroke(stroke, strokeOptions))}
            className="fill-blue-500 dark:fill-blue-400 opacity-80"
          />
        ))}

        {/* Render my current stroke */}
        {currentStroke.length > 0 && (
          <path
            d={getSvgPathFromStroke(getStroke(currentStroke, strokeOptions))}
            className="fill-zinc-800 dark:fill-zinc-200"
          />
        )}
      </svg>
    </div>
  );
}
