'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';
import { supabase } from '@/lib/supabase';
import { Trash2, Hand, Pencil, Download, Eraser, Type, Square, Circle, Share2, FilePlus, Lock, Unlock, MousePointer2, Save, Globe, Lock as LockIcon, Loader2, LayoutDashboard, Check } from 'lucide-react';
import Auth from './Auth';
import { User } from '@supabase/supabase-js';

type Point = [number, number, number]; 
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
type Tool = 'draw' | 'pan' | 'erase' | 'text' | 'rect' | 'circle' | 'select';

type LiveUser = {
  tool: 'draw' | 'rect' | 'circle';
  color: string;
  points?: Point[];
  shape?: ShapeElement;
};

const COLORS = [
  '#fafafa', 
  '#ef4444', 
  '#f59e0b', 
  '#10b981', 
  '#3b82f6', 
  '#8b5cf6', 
];

const strokeOptions = { size: 8, thinning: 0.5, smoothing: 0.5, streamline: 0.5 };

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
  const [isLocked, setIsLocked] = useState(false);
  const [draftText, setDraftText] = useState<{ x: number, y: number, text: string } | null>(null);

  // Auth & Persistence State
  const [user, setUser] = useState<User | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [canvasName, setCanvasName] = useState('Untitled Canvas');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // New Selection & Dragging State
  type SelectedItem = { id: string, type: 'stroke' | 'shape' | 'text' };
  const [selectedElement, setSelectedElement] = useState<SelectedItem | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [remoteDrags, setRemoteDrags] = useState<Record<string, { dx: number, dy: number }>>({});
  const isDraggingNode = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const activeTool = isLocked ? 'pan' : (isSpacePressed ? 'pan' : tool);
  
  const isDrawing = useRef(false);
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 }); 
  const lastSendTime = useRef(0);
  
  const [myUserId] = useState(() => Math.random().toString(36).substring(7));
  const roomRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [roomId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || 'drawing-room';
    }
    return 'drawing-room';
  });

  const [windowSize, setWindowSize] = useState({ 
    w: typeof window !== 'undefined' ? window.innerWidth : 0, 
    h: typeof window !== 'undefined' ? window.innerHeight : 0 
  });

  useEffect(() => {
    const handleResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (e.code === 'Space' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
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
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadCanvas = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('canvases')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (data && !error) {
      setStrokes(data.content.strokes || []);
      setShapes(data.content.shapes || []);
      setTexts(data.content.texts || []);
      setIsPublic(data.is_public);
      setOwnerId(data.owner_id);
      if (data.name) setCanvasName(data.name);
    }
    setIsLoading(false);
  }, [roomId]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  const saveCanvas = useCallback(async (isAutoSave = false) => {
    if (!user) {
      if (!isAutoSave) alert('You must be signed in to save your work!');
      return;
    }
    
    if (!isAutoSave) setIsSaving(true);
    const content = { strokes, shapes, texts };
    
    // Upsert canvas
    const { error } = await supabase
      .from('canvases')
      .upsert({
        room_id: roomId,
        owner_id: user.id,
        name: canvasName,
        content,
        is_public: isPublic,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });

    if (error) {
      console.error('Save error:', error);
      if (!isAutoSave) alert('Failed to save canvas: ' + error.message);
    } else {
      setOwnerId(user.id);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
    if (!isAutoSave) setIsSaving(false);
  }, [user, strokes, shapes, texts, canvasName, isPublic, roomId]);

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    if (isLoading || !user || isSaving) return;
    if (ownerId && user.id !== ownerId) return;
    if (!ownerId && strokes.length === 0 && shapes.length === 0 && texts.length === 0) return;

    const timeoutId = setTimeout(() => {
      saveCanvas(true);
    }, 5000);
    
    return () => clearTimeout(timeoutId);
  }, [strokes, shapes, texts, canvasName, saveCanvas, isLoading, user, ownerId, isSaving]);

  const togglePrivacy = async () => {
    if (!user || user.id !== ownerId) return;
    const nextPrivacy = !isPublic;
    setIsPublic(nextPrivacy);
    
    await supabase
      .from('canvases')
      .update({ is_public: nextPrivacy })
      .eq('room_id', roomId);
  };

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = '';
  }, [activeTool]);

  useEffect(() => {
    const channel = supabase.channel(`board-${roomId}`, {
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
          setStrokes([]); setTexts([]); setShapes([]);
          liveUsersRef.current = {}; setLiveUsers({});
          // New explicit Drag event networking triggers
        } else if (payload.type === 'drag_element') {
          setRemoteDrags(prev => ({ ...prev, [payload.id]: { dx: payload.dx, dy: payload.dy } }));
        } else if (payload.type === 'finish_drag_stroke') {
          setRemoteDrags(prev => { const n = {...prev}; delete n[payload.id]; return n; });
          setStrokes(s => s.map(x => x.id === payload.id ? { ...x, points: payload.points } : x));
        } else if (payload.type === 'finish_drag_shape') {
          setRemoteDrags(prev => { const n = {...prev}; delete n[payload.id]; return n; });
          setShapes(s => s.map(x => x.id === payload.id ? { ...x, x: payload.x, y: payload.y } : x));
        } else if (payload.type === 'finish_drag_text') {
          setRemoteDrags(prev => { const n = {...prev}; delete n[payload.id]; return n; });
          setTexts(s => s.map(x => x.id === payload.id ? { ...x, x: payload.x, y: payload.y } : x));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      roomRef.current = null;
    };
  }, [roomId]);

  const drawBoard = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, isExport: boolean = false) => {
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    
    if (isExport) {
      ctx.fillStyle = '#18181b'; 
      ctx.fillRect(0, 0, width * dpr, height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.z, camera.z);

    if (!isExport) {
      const startX = -camera.x / camera.z;
      const startY = -camera.y / camera.z;
      const logicalWidth = width / camera.z;
      const logicalHeight = height / camera.z;
      const endX = startX + logicalWidth;
      const endY = startY + logicalHeight;

      ctx.strokeStyle = '#27272a'; 
      ctx.lineWidth = 1 / camera.z;
      ctx.beginPath();
      const gridSize = 40;
      const firstX = Math.floor(startX / gridSize) * gridSize;
      for (let x = firstX; x < endX; x += gridSize) {
        ctx.moveTo(x, startY); ctx.lineTo(x, endY);
      }
      const firstY = Math.floor(startY / gridSize) * gridSize;
      for (let y = firstY; y < endY; y += gridSize) {
        ctx.moveTo(startX, y); ctx.lineTo(endX, y);
      }
      ctx.stroke();
    }

    // Helper dynamically translates context physically rendering an ephemeral delta 
    const getOffset = (id: string) => {
      if (selectedElement?.id === id) return dragOffset;
      if (remoteDrags[id]) return remoteDrags[id];
      return { dx: 0, dy: 0 };
    };

    const applyTransform = (id: string, renderCallback: () => void) => {
      const off = getOffset(id);
      if (off.dx !== 0 || off.dy !== 0) {
        ctx.save();
        ctx.translate(off.dx, off.dy);
        renderCallback();
        ctx.restore();
      } else {
        renderCallback();
      }
    };

    const drawStroke = (points: Point[], strokeColor: string, alpha: number = 1) => {
      if (points.length === 0) return;
      const pathData = getSvgPathFromStroke(getStroke(points, strokeOptions));
      ctx.fillStyle = strokeColor;
      ctx.globalAlpha = alpha;
      ctx.fill(new Path2D(pathData));
      ctx.globalAlpha = 1;
    };

    const drawShape = (s: ShapeElement, alpha: number = 1) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4; 
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      if (s.type === 'rect') {
        if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.width, s.height, 8);
        else ctx.rect(s.x, s.y, s.width, s.height);
      } else if (s.type === 'circle') {
        ctx.ellipse(s.x + s.width/2, s.y + s.height/2, Math.abs(s.width/2), Math.abs(s.height/2), 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    strokes.forEach(s => applyTransform(s.id, () => drawStroke(s.points, s.color)));
    shapes.forEach(s => applyTransform(s.id, () => drawShape(s)));
    
    Object.values(liveUsersRef.current).forEach(user => {
      if (user.tool === 'draw' && user.points) drawStroke(user.points, user.color, 0.8);
      else if ((user.tool === 'rect' || user.tool === 'circle') && user.shape) drawShape(user.shape, 0.8);
    });

    if (activeTool === 'draw' && currentStroke.length > 0) drawStroke(currentStroke, color);
    if (draftShape) drawShape({...draftShape, color});

    ctx.textBaseline = 'middle';
    ctx.font = '24px sans-serif'; 
    texts.forEach(t => applyTransform(t.id, () => {
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }));

    if (selectedElement && !isExport) {
      const off = getOffset(selectedElement.id);
      ctx.save();
      ctx.translate(off.dx, off.dy);
      ctx.strokeStyle = '#3b82f6'; 
      ctx.lineWidth = 2 / camera.z;
      ctx.setLineDash([5 / camera.z, 5 / camera.z]);
      ctx.beginPath();
      
      if (selectedElement.type === 'stroke') {
        const s = strokes.find(x => x.id === selectedElement.id);
        if (s) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          s.points.forEach(p => {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
          });
          ctx.strokeRect(minX - 10, minY - 10, maxX - minX + 20, maxY - minY + 20);
        }
      } else if (selectedElement.type === 'shape') {
        const s = shapes.find(x => x.id === selectedElement.id);
        if (s) {
           ctx.strokeRect(s.x - 10, s.y - 10, s.width + 20, s.height + 20);
        }
      } else if (selectedElement.type === 'text') {
        const t = texts.find(x => x.id === selectedElement.id);
        if (t) {
          ctx.strokeRect(t.x - 10, t.y - 15, t.text.length * 14 + 20, 30);
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }, [strokes, shapes, texts, currentStroke, draftShape, camera, activeTool, color, selectedElement, dragOffset, remoteDrags]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    
    drawBoard(ctx, rect.width, rect.height, dpr, false);
  }, [drawBoard, liveUsers, windowSize]);

  const getCanvasPoint = (clientX: number, clientY: number, pressure: number = 0.5): Point => [
    (clientX - camera.x) / camera.z,
    (clientY - camera.y) / camera.z,
    pressure
  ];

  const getElementBounds = (id: string, type: 'stroke' | 'shape' | 'text') => {
    if (type === 'stroke') {
      const s = strokes.find(x => x.id === id);
      if (!s) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      s.points.forEach(p => {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      });
      return { minX, maxX, minY, maxY };
    } else if (type === 'shape') {
      const s = shapes.find(x => x.id === id);
      if (!s) return null;
      if (s.type === 'rect') return { minX: s.x, maxX: s.x + s.width, minY: s.y, maxY: s.y + s.height };
      if (s.type === 'circle') return { minX: s.x, maxX: s.x + s.width, minY: s.y, maxY: s.y + s.height };
    } else if (type === 'text') {
      const t = texts.find(x => x.id === id);
      if (!t) return null;
      return { minX: t.x, maxX: t.x + t.text.length * 14, minY: t.y - 15, maxY: t.y + 15 };
    }
    return null;
  };

  function findHitElement(px: number, py: number): SelectedItem | null {
    if (selectedElement) {
      const bounds = getElementBounds(selectedElement.id, selectedElement.type);
      if (bounds && px >= bounds.minX - 10 && px <= bounds.maxX + 10 && py >= bounds.minY - 10 && py <= bounds.maxY + 10) {
        return selectedElement;
      }
    }

    const HIT_RADIUS = 15 / camera.z;
    
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      const textWidth = t.text.length * 14; 
      if (px >= t.x && px <= t.x + textWidth && Math.abs(t.y - py) < 15) return { id: t.id, type: 'text' };
    }
    
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.type === 'rect') {
        if (px >= s.x && px <= s.x + s.width && py >= s.y && py <= s.y + s.height) return { id: s.id, type: 'shape' };
      } else if (s.type === 'circle') {
         const cx = s.x + s.width / 2, cy = s.y + s.height / 2, rx = Math.abs(s.width / 2), ry = Math.abs(s.height / 2);
         if (rx > 0 && ry > 0 && (px - cx)**2 / (rx * rx) + (py - cy)**2 / (ry * ry) <= 1) return { id: s.id, type: 'shape' };
      }
    }
    
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (stroke.points.some(([x, y]) => Math.hypot(x - px, y - py) < HIT_RADIUS)) return { id: stroke.id, type: 'stroke' };
    }
    return null;
  }

  function eraseAtPoint(point: Point) {
    const [px, py] = point;
    const hit = findHitElement(px, py);
    if (!hit) return;
    
    if (hit.type === 'stroke') {
      setStrokes(s => s.filter(x => x.id !== hit.id));
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase', strokeId: hit.id } });
    } else if (hit.type === 'shape') {
      setShapes(s => s.filter(x => x.id !== hit.id));
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase_shape', shapeId: hit.id } });
    } else if (hit.type === 'text') {
      setTexts(t => t.filter(x => x.id !== hit.id));
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'erase_text', textId: hit.id } });
    }
  }

  function commitDraftText() {
    if (!draftText) return;
    if (draftText.text.trim().length > 0) {
      const newText: TextElement = {
        id: Math.random().toString(36).substring(7),
        x: draftText.x, y: draftText.y, text: draftText.text.trim(), color
      };
      setTexts(prev => [...prev, newText]);
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'add_text', textElement: newText } });
    }
    setDraftText(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool !== 'text') {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
    if (draftText) { commitDraftText(); return; }
    
    if (e.button === 1 || activeTool === 'pan') {
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    if (activeTool === 'select') {
      const point = getCanvasPoint(e.clientX, e.clientY);
      const hit = findHitElement(point[0], point[1]);
      setSelectedElement(hit);
      if (hit) {
         isDraggingNode.current = true;
         dragStart.current = { x: point[0], y: point[1] };
         setDragOffset({ dx: 0, dy: 0 });
      }
      return;
    }
    
    if (activeTool === 'draw') {
      isDrawing.current = true;
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      setCurrentStroke([point]);
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'move', userId: myUserId, points: [point], color } });
    } else if (activeTool === 'erase') {
      isDrawing.current = true; 
      eraseAtPoint(getCanvasPoint(e.clientX, e.clientY, e.pressure));
    } else if (activeTool === 'text') {
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      setDraftText({ x: point[0], y: point[1], text: '' });
      setSelectedElement(null);
    } else if (activeTool === 'rect' || activeTool === 'circle') {
      isDrawing.current = true;
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure);
      lastPanPoint.current = { x: point[0], y: point[1] }; 
      const newShape: ShapeElement = {
        id: Math.random().toString(36).substring(7),
        type: activeTool, x: point[0], y: point[1], width: 0, height: 0, color
      };
      setDraftShape(newShape);
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'shape_move', userId: myUserId, shape: newShape } });
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (isPanning.current) {
      const dx = e.clientX - lastPanPoint.current.x;
      const dy = e.clientY - lastPanPoint.current.y;
      setCamera(c => ({ ...c, x: c.x + dx, y: c.y + dy }));
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (activeTool === 'select') {
      if (isDraggingNode.current && selectedElement) {
        const point = getCanvasPoint(e.clientX, e.clientY);
        const dx = point[0] - dragStart.current.x;
        const dy = point[1] - dragStart.current.y;
        setDragOffset({ dx, dy });
        
        const now = Date.now();
        if (now - lastSendTime.current > 30) {
          roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'drag_element', id: selectedElement.id, dx, dy } });
          lastSendTime.current = now;
        }
        return;
      } else {
        const point = getCanvasPoint(e.clientX, e.clientY);
        let cursor = '';
        if (selectedElement) {
           const bounds = getElementBounds(selectedElement.id, selectedElement.type);
           if (bounds && point[0] >= bounds.minX - 10 && point[0] <= bounds.maxX + 10 && point[1] >= bounds.minY - 10 && point[1] <= bounds.maxY + 10) {
              cursor = 'move';
           }
        }
        if (canvasRef.current && !isPanning.current) canvasRef.current.style.cursor = cursor;
      }
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

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool !== 'text') {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (isPanning.current) { isPanning.current = false; return; }

    if (activeTool === 'select' && isDraggingNode.current && selectedElement) {
      isDraggingNode.current = false;
      const { dx, dy } = dragOffset;
      if (dx !== 0 || dy !== 0) {
        if (selectedElement.type === 'stroke') {
           setStrokes(prev => prev.map(s => {
             if (s.id === selectedElement.id) {
               const newPoints = s.points.map(p => [(p[0] + dx), (p[1] + dy), p[2]] as Point);
               roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'finish_drag_stroke', id: s.id, points: newPoints } });
               return { ...s, points: newPoints };
             }
             return s;
           }));
        } else if (selectedElement.type === 'shape') {
           setShapes(prev => prev.map(s => {
             if (s.id === selectedElement.id) {
               roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'finish_drag_shape', id: s.id, x: s.x + dx, y: s.y + dy } });
               return { ...s, x: s.x + dx, y: s.y + dy };
             }
             return s;
           }));
        } else if (selectedElement.type === 'text') {
           setTexts(prev => prev.map(t => {
             if (t.id === selectedElement.id) {
               roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'finish_drag_text', id: t.id, x: t.x + dx, y: t.y + dy } });
               return { ...t, x: t.x + dx, y: t.y + dy };
             }
             return t;
           }));
        }
      }
      setDragOffset({ dx: 0, dy: 0 });
      roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'drag_element', id: selectedElement.id, dx: 0, dy: 0 } });
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
        roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'shape_cancel', userId: myUserId } });
      }
      setDraftShape(null);
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
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
    const originalCanvas = canvasRef.current;
    if (!originalCanvas) return;
    
    const rect = originalCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    const eCanvas = document.createElement('canvas');
    eCanvas.width = rect.width * dpr;
    eCanvas.height = rect.height * dpr;
    const ctx = eCanvas.getContext('2d');
    if (!ctx) return;

    drawBoard(ctx, rect.width, rect.height, dpr, true);
    
    const pngUrl = eCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = `drawing-${roomId}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function copyShareLink() {
    let url = window.location.href;
    if (!window.location.search.includes('room=')) {
      url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    }
    navigator.clipboard.writeText(url);
    alert('Canvas link copied to clipboard! Share it with anyone to draw together!');
  }

  function createNewBoard() {
    const newRoomId = Math.random().toString(36).substring(2, 12);
    window.location.href = `${window.location.origin}${window.location.pathname}?room=${newRoomId}`;
  }

  function clearBoard() {
    setStrokes([]); setTexts([]); setShapes([]); setSelectedElement(null);
    roomRef.current?.send({ type: 'broadcast', event: 'draw', payload: { type: 'clear' } });
  }
  
  const getCursorClass = () => {
    if (activeTool === 'pan') return 'cursor-grab active:cursor-grabbing';
    if (activeTool === 'text') return 'cursor-text';
    if (activeTool === 'erase') return ''; 
    return 'cursor-crosshair';
  };

  const toolButtonClass = (t: Tool) => `p-3 rounded-lg transition-colors flex items-center justify-center ${tool === t ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'}`;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-900 touch-none">
      <div className="absolute top-6 left-6 z-20 flex items-center gap-3">
        <input 
          value={canvasName} 
          onChange={(e) => setCanvasName(e.target.value)}
          readOnly={Boolean(user && ownerId && user.id !== ownerId)}
          placeholder="Untitled Canvas"
          className="bg-transparent text-white font-semibold text-lg hover:bg-white/10 px-4 py-2 rounded-xl border border-transparent focus:border-indigo-500/50 focus:bg-zinc-800/50 outline-none transition-all min-w-[150px] shadow-sm"
        />
      </div>

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 items-center bg-white dark:bg-zinc-800 p-2 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700">
        <button onClick={() => setTool('select')} className={toolButtonClass('select')} title="Select / Move"><MousePointer2 size={20} /></button>
        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        
        <button onClick={() => setTool('draw')} className={toolButtonClass('draw')} title="Draw (Pencil)"><Pencil size={20} /></button>
        <button onClick={() => setTool('rect')} className={toolButtonClass('rect')} title="Rectangle"><Square size={20} /></button>
        <button onClick={() => setTool('circle')} className={toolButtonClass('circle')} title="Circle"><Circle size={20} /></button>
        <button onClick={() => setTool('text')} className={toolButtonClass('text')} title="Text"><Type size={20} /></button>
        <button onClick={() => setTool('erase')} className={toolButtonClass('erase')} title="Eraser"><Eraser size={20} /></button>
        <button onClick={() => setTool('pan')} className={toolButtonClass('pan')} title="Pan (Hand)"><Hand size={20} /></button>
        
        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <div className="flex gap-1 ml-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                if (tool === 'pan' || tool === 'erase' || tool === 'select') setTool('draw'); 
              }}
              className={`w-7 h-7 rounded-full transition-transform ${color === c && tool !== 'pan' && tool !== 'erase' ? 'scale-110 shadow-sm ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-800' : 'opacity-80 hover:opacity-100 hover:scale-110'}`}
              style={{ backgroundColor: c }}
              title={`Color ${c}`}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1 ml-2" />
        
        <button 
          onClick={() => setIsLocked(!isLocked)} 
          className={`p-3 rounded-lg transition-colors flex items-center justify-center ${isLocked ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'}`} 
          title={isLocked ? "Unlock Canvas" : "Lock Canvas (View Only)"}
        >
          {isLocked ? <Lock size={20} /> : <Unlock size={20} />}
        </button>
        <button onClick={createNewBoard} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400" title="New Board"><FilePlus size={20} /></button>
        <button onClick={copyShareLink} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400" title="Share Link"><Share2 size={20} /></button>
        <button onClick={exportToPng} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400" title="Export as PNG"><Download size={20} /></button>
        <button onClick={clearBoard} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-red-500" title="Clear Board"><Trash2 size={20} /></button>
        
        <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        
        {user && (!ownerId || user.id === ownerId) && (
          <>
            <button 
              onClick={togglePrivacy} 
              className={`p-3 rounded-lg transition-colors flex items-center justify-center ${isPublic ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700' : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/40'}`}
              title={isPublic ? "Currently Public" : "Currently Private"}
            >
              {isPublic ? <Globe size={20} /> : <LockIcon size={20} />}
            </button>
            <button 
              onClick={() => saveCanvas(false)} 
              disabled={isSaving}
              className={`p-3 rounded-lg transition-colors flex items-center justify-center ${
                isSaving ? 'text-zinc-400' : 
                saveSuccess ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/40' : 
                'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40'
              }`} 
              title={saveSuccess ? "Saved Successfully!" : "Save to Cloud"}
            >
              {isSaving ? <Loader2 size={20} className="animate-spin" /> : 
               saveSuccess ? <Check size={20} /> : <Save size={20} />}
            </button>
          </>
        )}
        
        {user && (
          <a 
            href="/dashboard"
            className="p-3 mr-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            title="Go to Canvases Dashboard"
          >
            <LayoutDashboard size={20} />
          </a>
        )}
        <div className="ml-2">
          <Auth />
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 z-100 flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={40} className="text-indigo-500 animate-spin" />
            <span className="text-white font-medium">Loading Canvas...</span>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`w-full h-full touch-none ${getCursorClass()}`}
        style={activeTool === 'erase' ? { cursor: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="14" fill="none" stroke="%23999" stroke-width="2"/></svg>') 15 15, auto` } : {}}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      
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
