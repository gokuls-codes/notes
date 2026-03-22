'use client';

import { useEffect, useState, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import { supabase } from '@/lib/supabase';
import { Trash2, Hand, Pencil, Download, Eraser, Type, Square, Circle } from 'lucide-react';

type Point = [number, number, number]; // [x, y, pressure]
type Stroke = {
  id: string;
  points: Point[];
  color: string;
};
type TextElement = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
};
type ShapeType = 'rect' | 'circle';
type ShapeElement = {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};
type Tool = 'draw' | 'pan' | 'erase' | 'text' | 'rect' | 'circle';

type LiveUser = {
  tool: 'draw' | 'rect' | 'circle';
  color: string;
  points?: Point[];
  shape?: ShapeElement;
};

const COLORS = [
  '#fafafa', // zinc-50 (white)
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
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [shapes, setShapes] = useState<ShapeElement[]>([]);
  
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [draftShape, setDraftShape] = useState<ShapeElement | null>(null);
  
  const [liveUsers, setLiveUsers] = useState<Record<string, LiveUser>>({});
  const liveUsersRef = useRef<Record<string, LiveUser>>({});
  
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [draftText, setDraftText] = useState<{ x: number, y: number, text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const activeTool = isSpacePressed ? 'pan' : tool;
  
  const isDrawing = useRef(false);
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 }); // Serves as both pan start and shape start
  const lastSendTime = useRef(0);
  
  const [myUserId] = useState(() => Math.random().toString(36).substring(7));
  const roomRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement === document.body) {
        e.preventDefault();
        if (!e.repeat) setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const isDraftTextOpen = draftText !== null;
  useEffect(() => {
    if (isDraftTextOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isDraftTextOpen]);

  useEffect(() => {
    const channel = supabase.channel('drawing-room', {
      config: { broadcast: { ack: false } }
    });
    
    roomRef.current = channel;

    channel
      .on('broadcast', { event: 'draw' }, ({ payload }) => {
        if (payload.type === 'move') {
          liveUsersRef.current[payload.userId] = { tool: 'draw', points: payload.points, color: payload.color };
          setLiveUsers({ ...liveUsersRef.current });
        } else if (payload.type === 'end') {
          const liveUser = liveUsersRef.current[payload.userId];
          if (liveUser && liveUser.points) {
            setStrokes(s => [...s, { id: payload.strokeId || Math.random().toString(36).substring(7), points: liveUser.points!, color: liveUser.color }]);
          }
          delete liveUsersRef.current[payload.userId];
          setLiveUsers({ ...liveUsersRef.current });
        } else if (payload.type === 'shape_move') {
          liveUsersRef.current[payload.userId] = { tool: payload.shape.type, shape: payload.shape, color: payload.shape.color };
          setLiveUsers({ ...liveUsersRef.current });
        } else if (payload.type === 'shape_end') {
          setShapes(s => [...s, payload.shape]);
          delete liveUsersRef.current[payload.userId];
          setLiveUsers({ ...liveUsersRef.current });
        } else if (payload.type === 'shape_cancel') {
          delete liveUsersRef.current[payload.userId];
          setLiveUsers({ ...liveUsersRef.current });
        } else if (payload.type === 'erase') {
          setStrokes(s => s.filter(stroke => stroke.id !== payload.strokeId));
        } else if (payload.type === 'add_text') {
          setTexts(t => [...t, payload.textElement]);
        } else if (payload.type === 'erase_text') {
          setTexts(t => t.filter(x => x.id !== payload.textId));
        } else if (payload.type === 'erase_shape') {
          setShapes(s => s.filter(x => x.id !== payload.shapeId));
        } else if (payload.type === 'clear') {
          setStrokes([]);
          setTexts([]);
          setShapes([]);
          liveUsersRef.current = {};
          setLiveUsers({});
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      roomRef.current = null;
    };
  }, []);

  const getCanvasPoint = (clientX: number, clientY: number, pressure: number = 0.5): Point => [
    (clientX - camera.x) / camera.z,
    (clientY - camera.y) / camera.z,
    pressure
  ];

  function eraseAtPoint(point: Point) {
    const [px, py] = point;
    const ERASER_RADIUS = 15 / camera.z; 
    
    setStrokes(prevStrokes => {
      const strokesToDelete = prevStrokes.filter(stroke => {
        return stroke.points.some(([x, y]) => Math.hypot(x - px, y - py) < ERASER_RADIUS);
      });
      
      if (strokesToDelete.length === 0) return prevStrokes;
      
      strokesToDelete.forEach(stroke => {
        roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase', strokeId: stroke.id } });
      });
      
      const toDeleteIds = new Set(strokesToDelete.map(s => s.id));
      return prevStrokes.filter(s => !toDeleteIds.has(s.id));
    });

    setTexts(prevTexts => {
      const textsToDelete = prevTexts.filter(t => {
        const charWidth = 14; 
        const textWidth = t.text.length * charWidth;
        return px >= t.x && px <= t.x + textWidth && Math.abs(t.y - py) < 15;
      });
      
      if (textsToDelete.length > 0) {
        textsToDelete.forEach(t => {
          roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase_text', textId: t.id } });
        });
        const toDeleteIds = new Set(textsToDelete.map(x => x.id));
        return prevTexts.filter(x => !toDeleteIds.has(x.id));
      }
      return prevTexts;
    });

    setShapes(prevShapes => {
      const shapesToDelete = prevShapes.filter(s => {
        if (s.type === 'rect') {
          return px >= s.x && px <= s.x + s.width && py >= s.y && py <= s.y + s.height;
        } else if (s.type === 'circle') {
          const cx = s.x + s.width / 2;
          const cy = s.y + s.height / 2;
          const rx = s.width / 2;
          const ry = s.height / 2;
          if (rx === 0 || ry === 0) return false;
          const dx = px - cx;
          const dy = py - cy;
          return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
        }
        return false;
      });
      
      if (shapesToDelete.length > 0) {
        shapesToDelete.forEach(s => {
          roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase_shape', shapeId: s.id } });
        });
        const toDeleteIds = new Set(shapesToDelete.map(x => x.id));
        return prevShapes.filter(x => !toDeleteIds.has(x.id));
      }
      return prevShapes;
    });
  }

  function commitDraftText() {
    if (!draftText) return;
    
    if (draftText.text.trim().length > 0) {
      const newText: TextElement = {
        id: Math.random().toString(36).substring(7),
        x: draftText.x,
        y: draftText.y,
        text: draftText.text.trim(),
        color
      };
      
      setTexts(prev => [...prev, newText]);
      roomRef.current?.send({
        type: 'broadcast',
        event: 'draw',
        payload: { type: 'add_text', textElement: newText }
      });
    }
    setDraftText(null);
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (activeTool !== 'text') {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }

    if (draftText) {
      commitDraftText();
      return; 
    }
    
    if (e.button === 1 || activeTool === 'pan') {
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    if (activeTool === 'draw') {
      isDrawing.current = true;
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      setCurrentStroke([point]);
      
      roomRef.current?.send({
        type: 'broadcast',
        event: 'draw',
        payload: { type: 'move', userId: myUserId, points: [point], color }
      });
    } else if (activeTool === 'erase') {
      isDrawing.current = true; 
      eraseAtPoint(getCanvasPoint(e.clientX, e.clientY, e.pressure));
    } else if (activeTool === 'text') {
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      setDraftText({ x: point[0], y: point[1], text: '' });
    } else if (activeTool === 'rect' || activeTool === 'circle') {
      isDrawing.current = true;
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      lastPanPoint.current = { x: point[0], y: point[1] }; 
      const newShape: ShapeElement = {
        id: Math.random().toString(36).substring(7),
        type: activeTool,
        x: point[0],
        y: point[1],
        width: 0,
        height: 0,
        color
      };
      setDraftShape(newShape);
      roomRef.current?.send({
        type: 'broadcast',
        event: 'draw',
        payload: { type: 'shape_move', userId: myUserId, shape: newShape }
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

    if (!isDrawing.current) return;
    
    if (activeTool === 'erase') {
      eraseAtPoint(getCanvasPoint(e.clientX, e.clientY, e.pressure));
      return;
    }
    
    if (activeTool === 'rect' || activeTool === 'circle') {
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      const startX = lastPanPoint.current.x;
      const startY = lastPanPoint.current.y;
      
      setDraftShape(prev => {
        if (!prev) return prev;
        const newShape = {
          ...prev,
          x: Math.min(startX, point[0]),
          y: Math.min(startY, point[1]),
          width: Math.abs(point[0] - startX),
          height: Math.abs(point[1] - startY),
        };
        
        const now = Date.now();
        if (now - lastSendTime.current > 50) {
          roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'shape_move', userId: myUserId, shape: newShape } });
          lastSendTime.current = now;
        }
        return newShape;
      });
      return;
    }
    
    if (activeTool !== 'draw') return;
    
    const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
    
    setCurrentStroke(prev => {
      const newStroke = [...prev, point];
      
      const now = Date.now();
      if (now - lastSendTime.current > 50) {
        roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'move', userId: myUserId, points: newStroke, color } });
        lastSendTime.current = now;
      }
      return newStroke;
    });
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (activeTool !== 'text') {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }

    if (!isDrawing.current) return;
    isDrawing.current = false;
    
    if (activeTool === 'draw') {
      const newId = Math.random().toString(36).substring(7);
      setStrokes(prev => [...prev, { id: newId, points: currentStroke, color }]);
      setCurrentStroke([]);
      
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'end', userId: myUserId, strokeId: newId } });
    } else if (activeTool === 'rect' || activeTool === 'circle') {
      if (draftShape && Math.hypot(draftShape.width, draftShape.height) > 5) {
        setShapes(prev => [...prev, draftShape]);
        roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'shape_end', userId: myUserId, shape: draftShape } });
      } else {
        // Cancel tiny accidental clicks
        roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'shape_cancel', userId: myUserId } });
      }
      setDraftShape(null);
    }
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    if (e.ctrlKey || e.metaKey) {
      const zoomSensitivity = 0.005;
      const zoomDelta = -e.deltaY * zoomSensitivity;
      const newZ = Math.min(Math.max(0.1, camera.z + zoomDelta), 5);
      
      const newX = e.clientX - ((e.clientX - camera.x) / camera.z) * newZ;
      const newY = e.clientY - ((e.clientY - camera.y) / camera.z) * newZ;

      setCamera({ x: newX, y: newY, z: newZ });
    } else {
      setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    }
  }

  function exportToPng() {
    const svgElement = document.getElementById('drawing-board-svg');
    if (!svgElement) return;

    const svgSize = svgElement.getBoundingClientRect();
    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
    clonedSvg.setAttribute('width', svgSize.width.toString());
    clonedSvg.setAttribute('height', svgSize.height.toString());

    // Remove the background grid from the export so lines stand out purely
    const gridRect = clonedSvg.querySelector('#grid-rect');
    if (gridRect) gridRect.remove();

    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    const canvas = document.createElement('canvas');
    
    const scale = window.devicePixelRatio || 2;
    canvas.width = svgSize.width * scale;
    canvas.height = svgSize.height * scale;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.scale(scale, scale);
    
    ctx.fillStyle = '#18181b'; 
    ctx.fillRect(0, 0, svgSize.width, svgSize.height);

    const img = new Image();
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      ctx.drawImage(img, 0, 0, svgSize.width, svgSize.height);
      URL.revokeObjectURL(url);
      
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `drawing-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    img.src = url;
  }

  function clearBoard() {
    setStrokes([]);
    setTexts([]);
    setShapes([]);
    roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'clear' } });
  }

  const strokeOptions = { size: 8, thinning: 0.5, smoothing: 0.5, streamline: 0.5 };
  
  const getCursorClass = () => {
    if (activeTool === 'pan') return 'cursor-grab active:cursor-grabbing';
    if (activeTool === 'text') return 'cursor-text';
    if (activeTool === 'erase') return ''; 
    return 'cursor-crosshair';
  };

  const toolButtonClass = (t: Tool) => `p-3 rounded-lg transition-colors flex items-center justify-center ${tool === t ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'}`;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-900 touch-none">
      {/* Toolbar */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 items-center bg-white dark:bg-zinc-800 p-2 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700">
        <button onClick={() => setTool('draw')} className={toolButtonClass('draw')} title="Draw (Pencil)"><Pencil size={20} /></button>
        <button onClick={() => setTool('rect')} className={toolButtonClass('rect')} title="Rectangle"><Square size={20} /></button>
        <button onClick={() => setTool('circle')} className={toolButtonClass('circle')} title="Circle"><Circle size={20} /></button>
        <button onClick={() => setTool('text')} className={toolButtonClass('text')} title="Text"><Type size={20} /></button>
        <button onClick={() => setTool('erase')} className={toolButtonClass('erase')} title="Eraser"><Eraser size={20} /></button>
        <button onClick={() => setTool('pan')} className={toolButtonClass('pan')} title="Pan (Hand)"><Hand size={20} /></button>
        
        {/* Colors */}
        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <div className="flex gap-1 ml-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                if (tool === 'pan' || tool === 'erase') setTool('draw'); 
              }}
              className={`w-7 h-7 rounded-full transition-transform ${color === c && tool !== 'pan' && tool !== 'erase' ? 'scale-110 shadow-sm ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-800' : 'opacity-80 hover:opacity-100 hover:scale-110'}`}
              style={{ backgroundColor: c }}
              title={`Color ${c}`}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1 ml-2" />
        
        <button onClick={exportToPng} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400" title="Export as PNG">
          <Download size={20} />
        </button>

        <button onClick={clearBoard} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-red-500" title="Clear Board">
          <Trash2 size={20} />
        </button>
      </div>

      <svg
        id="drawing-board-svg"
        xmlns="http://www.w3.org/2000/svg"
        className={`w-full h-full touch-none ${getCursorClass()}`}
        style={activeTool === 'erase' ? { cursor: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="14" fill="none" stroke="%23999" stroke-width="2"/></svg>') 15 15, auto` } : {}}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <pattern
            id="grid-pattern"
            width={40}
            height={40}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${camera.x}, ${camera.y}) scale(${camera.z})`}
          >
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" className="text-zinc-800" strokeWidth="1"/>
          </pattern>
        </defs>
        
        <rect id="grid-rect" width="100%" height="100%" fill="url(#grid-pattern)" />

        <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.z})`}>
          {strokes.map((stroke, i) => (
             <path key={stroke.id || `stroke-${i}`} d={getSvgPathFromStroke(getStroke(stroke.points, strokeOptions))} fill={stroke.color} />
          ))}
          
          {shapes.map((s) => (
            s.type === 'rect' ? (
              <rect key={s.id} x={s.x} y={s.y} width={s.width} height={s.height} fill="none" stroke={s.color} strokeWidth={4} rx={8} />
            ) : (
              <ellipse key={s.id} cx={s.x + s.width/2} cy={s.y + s.height/2} rx={s.width/2} ry={s.height/2} fill="none" stroke={s.color} strokeWidth={4} />
            )
          ))}

          {Object.entries(liveUsers).map(([userId, user]) => {
            if (user.tool === 'draw' && user.points) {
              return <path key={`live-${userId}`} d={getSvgPathFromStroke(getStroke(user.points, strokeOptions))} fill={user.color} className="opacity-80" />;
            } else if ((user.tool === 'rect' || user.tool === 'circle') && user.shape) {
              const s = user.shape;
              return s.type === 'rect' 
                ? <rect key={`live-${userId}`} x={s.x} y={s.y} width={s.width} height={s.height} fill="none" stroke={s.color} strokeWidth={4} rx={8} className="opacity-80" />
                : <ellipse key={`live-${userId}`} cx={s.x + s.width/2} cy={s.y + s.height/2} rx={s.width/2} ry={s.height/2} fill="none" stroke={s.color} strokeWidth={4} className="opacity-80" />;
            }
            return null;
          })}

          {currentStroke.length > 0 && activeTool === 'draw' && (
            <path d={getSvgPathFromStroke(getStroke(currentStroke, strokeOptions))} fill={color} />
          )}

          {draftShape && (
            draftShape.type === 'rect' ? (
              <rect x={draftShape.x} y={draftShape.y} width={draftShape.width} height={draftShape.height} fill="none" stroke={color} strokeWidth={4} rx={8} />
            ) : (
              <ellipse cx={draftShape.x + draftShape.width/2} cy={draftShape.y + draftShape.height/2} rx={draftShape.width/2} ry={draftShape.height/2} fill="none" stroke={color} strokeWidth={4} />
            )
          )}
          
          {texts.map(t => (
            <text 
              key={t.id} x={t.x} y={t.y} fill={t.color} fontSize={24} fontFamily="sans-serif" dominantBaseline="central"
            >{t.text}</text>
          ))}
        </g>
      </svg>
      
      {/* HTML Overlay Editor */}
      {draftText && (
        <input
          ref={inputRef}
          autoFocus
          placeholder="Type here..."
          value={draftText.text}
          onChange={e => setDraftText({ ...draftText, text: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') commitDraftText();
            if (e.key === 'Escape') setDraftText(null);
          }}
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: draftText.x * camera.z + camera.x,
            top: draftText.y * camera.z + camera.y - (14 * camera.z), 
            fontSize: `${24 * camera.z}px`,
            fontFamily: 'sans-serif',
            color: color,
            background: 'transparent',
            outline: 'none',
            border: 'none',
            minWidth: '200px',
            padding: 0,
            margin: 0,
            zIndex: 999999
          }}
        />
      )}
    </div>
  );
}
