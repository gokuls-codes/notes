import DrawingBoard from '@/components/DrawingBoard';
import ClientOnly from '@/components/ClientOnly';

export default function Home() {
  return (
    <div className="min-h-screen">
      <ClientOnly>
        <DrawingBoard />
      </ClientOnly>
    </div>
  );
}
