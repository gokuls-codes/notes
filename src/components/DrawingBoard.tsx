'use client';

import { useEffect, useState, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import { supabase } from '@/lib/supabase';
import { Trash2, Hand, Pencil } from 'lucide-react';

type Point = [number, number, number]; // [x, y, pressure]
type Stroke = {
  points: Point[];
  color: string;
};
type Tool = 'draw' | 'pan';

const COLORS = [
  '#18181b', // zinc-900 (black)
  '#ef4444', // red-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
];

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
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [liveUsers, setLiveUsers] = useState<Record<string, Stroke>>({});
  
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState<string>(COLORS[0]);
  
  const isDrawing = useRef(false);
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 });
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
            [payload.userId]: { points: payload.points, color: payload.color }
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

  // Helper to convert screen coordinates to pure canvas coordinates
  const getCanvasPoint = (clientX: number, clientY: number, pressure: number = 0.5): Point => [
    (clientX - camera.x) / camera.z,
    (clientY - camera.y) / camera.z,
    pressure
  ];

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture(e.pointerId);
    
    // Middle mouse button (1), right click (2), or Pan tool selected
    if (e.button === 1 || tool === 'pan') {
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    if (tool === 'draw') {
      isDrawing.current = true;
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      setCurrentStroke([point]);
      
      roomRef.current?.send({
        type: 'broadcast',
        event: 'draw',
        payload: { type: 'move', userId: myUserId, points: [point], color }
      });
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (isPanning.current) {
      const dx = e.clientX - lastPanPoint.current.x;
      const dy = e.clientY - lastPanPoint.current.y;
      setCamera(c => ({ ...c, x: c.x + dx, y: c.y + dy }));
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDrawing.current || tool !== 'draw') return;
    
    const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
    
    setCurrentStroke(prev => {
      const newStroke = [...prev, point];
      
      const now = Date.now();
      if (now - lastSendTime.current > 50) {
        roomRef.current?.send({
          type: 'broadcast',
          event: 'draw',
          payload: { type: 'move', userId: myUserId, points: newStroke, color }
        });
        lastSendTime.current = now;
      }
      return newStroke;
    });
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).releasePointerCapture(e.pointerId);
    
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }

    if (!isDrawing.current) return;
    isDrawing.current = false;
    
    setStrokes(prev => [...prev, { points: currentStroke, color }]);
    setCurrentStroke([]);
    
    roomRef.current?.send({
      type: 'broadcast',
      event: 'draw',
      payload: { type: 'end', userId: myUserId }
    });
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    // pinch-to-zoom fires with ctrlKey on trackpads or metaKey, or standard mouse wheel scroll
    if (e.ctrlKey || e.metaKey) {
      const zoomSensitivity = 0.005;
      const zoomDelta = -e.deltaY * zoomSensitivity;
      const newZ = Math.min(Math.max(0.1, camera.z + zoomDelta), 5); // limit zoom scale
      
      // zoom towards cursor point
      const newX = e.clientX - ((e.clientX - camera.x) / camera.z) * newZ;
      const newY = e.clientY - ((e.clientY - camera.y) / camera.z) * newZ;

      setCamera({ x: newX, y: newY, z: newZ });
    } else {
      // trackpad 2-finger pan
      setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    }
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
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 items-center bg-white dark:bg-zinc-800 p-2 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700">
        <button 
          onClick={() => setTool('draw')}
          className={`p-3 rounded-lg transition-colors flex items-center justify-center ${tool === 'draw' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'}`}
          title="Draw (Pencil)"
        >
          <Pencil size={20} />
        </button>
        <button 
          onClick={() => setTool('pan')}
          className={`p-3 rounded-lg transition-colors flex items-center justify-center ${tool === 'pan' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'}`}
          title="Pan (Hand)"
        >
          <Hand size={20} />
        </button>
        
        {/* Colors */}
        <div className="w-[1px] h-8 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <div className="flex gap-1 ml-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setTool('draw'); // Auto-switch to pencil when color is picked
              }}
              className={`w-7 h-7 rounded-full transition-transform ${color === c && tool === 'draw' ? 'scale-110 shadow-sm ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-800' : 'opacity-80 hover:opacity-100 hover:scale-110'}`}
              style={{ backgroundColor: c }}
              title={`Color ${c}`}
            />
          ))}
        </div>

        <div className="w-[1px] h-8 bg-zinc-200 dark:bg-zinc-700 mx-1 ml-2" />
        
        <button 
          onClick={clearBoard}
          className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-red-500"
          title="Clear Board"
        >
          <Trash2 size={20} />
        </button>
      </div>

      <svg
        className={`w-full h-full touch-none ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* The entire SVG canvas gets moved/scaled by our camera */}
        <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.z})`}>
          {/* Render committed strokes */}
          {strokes.map((stroke, i) => (
             <path
               key={`stroke-${i}`}
               d={getSvgPathFromStroke(getStroke(stroke.points, strokeOptions))}
               fill={stroke.color}
             />
          ))}

          {/* Render live remote strokes */}
          {Object.entries(liveUsers).map(([userId, stroke]) => (
            <path
              key={`live-${userId}`}
              d={getSvgPathFromStroke(getStroke(stroke.points, strokeOptions))}
              fill={stroke.color}
              className="opacity-80"
            />
          ))}

          {/* Render my current stroke */}
          {currentStroke.length > 0 && (
            <path
              d={getSvgPathFromStroke(getStroke(currentStroke, strokeOptions))}
              fill={color}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
