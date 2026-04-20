/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import PptxGenJS from 'pptxgenjs';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Key, 
  Cpu, 
  Layers, 
  ShieldCheck, 
  Users, 
  Globe, 
  Zap, 
  FileText, 
  Bot, 
  Settings, 
  CheckCircle2, 
  ArrowRight,
  Monitor,
  Database,
  Cloud,
  Lock,
  Search,
  MessageSquare,
  Workflow,
  Download,
  Maximize,
  Minimize
} from 'lucide-react';

// Types
interface Slide {
  id: number;
  title: string;
  subtitle?: string;
  purpose?: string;
  script?: string;
  content: ReactNode;
}

// --- COLOR FIX LOGIC FOR HTML2CANVAS ---
const colorCanvas = document.createElement('canvas');
const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

function resolveColorToHex(colorStr: string): string {
  if (!colorCtx) return colorStr;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000000'; // Reset
  colorCtx.fillStyle = colorStr;  // Browser parses oklab/color-mix natively
  return colorCtx.fillStyle;      // Returns a safe #RRGGBB format for html2canvas
}

function extractAndReplaceColors(cssValue: string): string {
  let result = cssValue;
  const functionNames = ['oklab', 'oklch', 'color-mix', 'color'];
  
  for (const fn of functionNames) {
    let startIndex = 0;
    while ((startIndex = result.indexOf(fn + '(', startIndex)) !== -1) {
      let depth = 0;
      let endIndex = -1;
      
      for (let i = startIndex + fn.length; i < result.length; i++) {
        if (result[i] === '(') depth++;
        else if (result[i] === ')') {
          depth--;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      }
      
      if (endIndex !== -1) {
        const colorString = result.slice(startIndex, endIndex + 1);
        const standardColor = resolveColorToHex(colorString);
        result = result.slice(0, startIndex) + standardColor + result.slice(endIndex + 1);
        startIndex += standardColor.length;
      } else {
        startIndex += fn.length; 
      }
    }
  }
  return result;
}
// --- END COLOR FIX LOGIC ---

const SLIDE_EXPORT_WIDTH = 1920;
const SLIDE_EXPORT_HEIGHT = 1080;
const PPTX_EXPORT_WIDTH = 13.333;
const PPTX_EXPORT_HEIGHT = 7.5;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const waitForNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const waitForImages = async (container: HTMLElement) => {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => resolve();
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    })
  );
};

function createStyleProbe() {
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed', left: '-10000px', top: '0', width: '0', height: '0',
    opacity: '0', pointerEvents: 'none',
  });
  document.body.appendChild(probe);

  return {
    resolve(property: string, value: string) {
      probe.style.removeProperty(property);
      probe.style.setProperty(property, value);
      const normalizedValue = window.getComputedStyle(probe).getPropertyValue(property).trim();
      probe.style.removeProperty(property);
      return normalizedValue || value;
    },
    dispose() {
      probe.remove();
    },
  };
}

function sanitizeStyleValue(
  property: string,
  value: string,
  resolveValue: (property: string, value: string) => string
) {
  let sanitizedValue = value.trim();
  if (!sanitizedValue) return sanitizedValue;

  if (property.startsWith('transition')) return property === 'transition-property' ? 'none' : '0s';
  if (property.startsWith('animation')) return property === 'animation-play-state' ? 'paused' : 'none';
  if (property === 'caret-color') return 'transparent';

  if (sanitizedValue.includes('var(')) {
    sanitizedValue = resolveValue(property, sanitizedValue).trim() || sanitizedValue;
  }

  if (sanitizedValue.includes('gradient')) {
    sanitizedValue = sanitizedValue.replace(
      /(linear-gradient|radial-gradient|conic-gradient)\(([^,]*?)\s+in\s+(oklab|oklch|srgb|linear-srgb)\s*,/gi,
      (match, gradType, prefix) => {
        const cleanPrefix = prefix.trim();
        return cleanPrefix === '' ? `${gradType}(` : `${gradType}(${cleanPrefix}, `;
      }
    );
  }

  if (/(oklab|oklch|color-mix|color)\(/i.test(sanitizedValue)) {
    sanitizedValue = extractAndReplaceColors(sanitizedValue);
  }

  return sanitizedValue;
}

function inlineSafeCaptureStyles(container: HTMLElement) {
  const styleProbe = createStyleProbe();
  try {
    const elements = [container, ...Array.from(container.querySelectorAll('*'))] as Array<HTMLElement | SVGElement>;
    for (const element of elements) {
      const computedStyle = window.getComputedStyle(element);
      for (const property of Array.from(computedStyle)) {
        if (property.startsWith('--')) continue;
        const rawValue = computedStyle.getPropertyValue(property);
        if (!rawValue) continue;
        const safeValue = sanitizeStyleValue(property, rawValue, styleProbe.resolve);
        if (!safeValue) continue;
        element.style.setProperty(property, safeValue, computedStyle.getPropertyPriority(property));
      }
      element.removeAttribute('class');
    }
  } finally {
    styleProbe.dispose();
  }
}

function ExportSlideSurface({ slide }: { slide: Slide }) {
  return (
    <div
      className="bg-white overflow-hidden"
      style={{ width: `${SLIDE_EXPORT_WIDTH}px`, height: `${SLIDE_EXPORT_HEIGHT}px` }}
    >
      {slide.content}
    </div>
  );
}

async function captureSlideAsImage(slide: Slide) {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed', left: '-10000px', top: '0', 
    width: `${SLIDE_EXPORT_WIDTH}px`, height: `${SLIDE_EXPORT_HEIGHT}px`,
    overflow: 'hidden', pointerEvents: 'none', background: '#ffffff', zIndex: '-1',
  });

  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    flushSync(() => {
      root.render(<ExportSlideSurface slide={slide} />);
    });

    if ('fonts' in document) {
      try { await document.fonts.ready; } catch {}
    }

    await waitForNextPaint();
    await wait(200);
    await waitForImages(host);
    await wait(150);

    const captureTarget = host.firstElementChild as HTMLElement | null;
    if (!captureTarget) throw new Error(`Slide ${slide.id} did not render for export.`);

    inlineSafeCaptureStyles(captureTarget);
    await waitForNextPaint();

    const canvas = await html2canvas(captureTarget, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 2,
      backgroundColor: '#ffffff',
      imageTimeout: 0,
      width: SLIDE_EXPORT_WIDTH,
      height: SLIDE_EXPORT_HEIGHT,
      windowWidth: SLIDE_EXPORT_WIDTH,
      windowHeight: SLIDE_EXPORT_HEIGHT,
      onclone: (clonedDoc: Document) => {
        // Destroy global stylesheets in iframe to prevent parser crashes
        const styles = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
        styles.forEach(style => style.remove());
      }
    });

    return canvas.toDataURL('image/png');
  } finally {
    root.unmount();
    host.remove();
  }
}

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [direction, setDirection] = useState(0); 
  const [exportFormat, setExportFormat] = useState<'pdf' | 'pptx' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fullscreen Logic
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const providerLogos = {
    anthropic: "/logos/claude.svg",
    google: "/logos/gemini.svg",
    openai: "/logos/openai.svg",
    alibaba: "/logos/qwen.svg",
  };

  const slides: Slide[] = [
    {
      id: 0,
      title: "Nebula Data Services",
      subtitle: "One Stop AI Solution",
      script: "Thank you for the time today. We're excited to introduce Nebula's All-in-One API Gateway. Our focus is eliminating complexity: one key to access 140+ leading models, custom agents to automate workflows, and enterprise-grade deployment that gives you total control.",
      content: (
        <div className="grid grid-cols-12 h-all h-full items-center px-12 gap-8">
          <div className="col-span-7 space-y-8">
            <div className="flex items-center gap-2 text-nebula-accent font-bold text-sm tracking-tight">
              <Zap size={16} fill="currentColor" />
              <span>Version 3.0 Release</span>
            </div>
            <h1 className="text-[120px] font-extrabold leading-[0.85] tracking-tighter text-nebula-text">
              All-in-One API <br />
              Gateway <br />
              <span className="gradient-text-saas">for LLM</span>
            </h1>
            <p className="text-2xl text-nebula-muted font-normal max-w-xl">
              Better prices, better uptime, <span className="text-nebula-text font-semibold underline decoration-nebula-accent/30 decoration-4">no subscription.</span>
            </p>
            <div className="flex items-center gap-4 pt-4">
              <button className="bg-nebula-accent text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-200" onClick={() => window.open('https://ai-nebula.com/', '_blank')}>
                Start Now <ArrowRight size={18} />
              </button>
              <button className="border border-slate-200 px-8 py-4 rounded-xl font-bold text-nebula-muted hover:bg-slate-50" onClick={() => window.open('mailto:gagahputrabangsa@nebula-data.com', '_blank')}>
                Contact Us
              </button>
            </div>
          </div>
          <div className="col-span-5 space-y-4">
            <div className="text-xs font-bold text-nebula-muted uppercase tracking-widest mb-4 flex justify-between items-center">
              <span>Featured Models</span>
              <span className="text-nebula-accent">View Trending ↗</span>
            </div>
            {[
              { name: "Gemini 3.1 Pro Preview", provider: "google", vol: "43.7B", lat: "3.3s", growth: "55.26%", color: "text-indigo-600" },
              { name: "GPT - 5.4", provider: "openai", vol: "56.0B", lat: "8.8s", growth: "35.26%", color: "text-slate-900" },
              { name: "Claude opus 4.7", provider: "anthropic", vol: "587.2B", lat: "1.3s", growth: "21.14%", color: "text-orange-600" }
            ].map((model, i) => (
              <motion.div 
                key={i}
                initial={{ x: 50, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                className="saas-card p-6 flex flex-col gap-4"
              >
                <div className="flex justify-between items-center">
                   <div>
                     <div className="font-bold text-nebula-text flex items-center gap-2">
                       {model.name} {i === 0 && <span className="bg-slate-100 text-[10px] px-2 py-0.5 rounded text-nebula-muted uppercase">New</span>}
                     </div>
                     <div className="text-xs text-nebula-muted font-medium">by {model.provider}</div>
                   </div>
                   <div className={`${model.color} opacity-40`}>
                      {i === 0 ? <Zap size={24} /> : i === 1 ? <Database size={24} /> : <Cpu size={24} />}
                   </div>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-50">
                   <div>
                      <div className="text-[10px] font-bold text-nebula-muted uppercase">Tokens/wk</div>
                      <div className="font-bold text-green-600">{model.vol}</div>
                   </div>
                   <div>
                      <div className="text-[10px] font-bold text-nebula-muted uppercase">Latency</div>
                      <div className="font-bold text-nebula-text">{model.lat}</div>
                   </div>
                   <div>
                      <div className="text-[10px] font-bold text-nebula-muted uppercase">Weekly Growth</div>
                      <div className="font-bold text-saas-pink">{model.growth}</div>
                   </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 1,
      title: "About Nebula Data",
      script: "Nebula Data, headquartered in Singapore with regional offices in Guangzhou, Shanghai, and Hong Kong, is a leader in cloud network integration and intelligent computing. We partner with Chinese enterprises to expand globally through integrated AI infrastructure, low-latency networks, and unified cloud management—empowering businesses to embrace AI and scale internationally.",
      content: (
        <div className="flex flex-col h-full p-12 justify-start gap-8 overflow-y-auto">
          <div className="space-y-4 pt-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-4 py-1.5 bg-indigo-50 text-nebula-accent text-xs font-bold rounded-full tracking-wide w-fit"
            >
              COMPANY PROFILE
            </motion.div>
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-5xl font-extrabold leading-[1.1] tracking-tight text-nebula-text max-w-3xl"
            >
              Empowering Global
              <span className="block mt-2 gradient-text-saas italic">
                Enterprise AI
              </span>
            </motion.h2>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="saas-card p-6 flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-nebula-accent flex items-center justify-center">
                <Globe size={24} />
              </div>
              <h3 className="text-lg font-bold text-nebula-text">Global Presence</h3>
              <p className="text-xs text-nebula-muted leading-relaxed">Headquartered in Singapore with strategic offices in Guangzhou, Shanghai, and Hong Kong, serving enterprises across Asia-Pacific.</p>
            </div>

            <div className="saas-card p-6 flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-nebula-accent flex items-center justify-center">
                <Zap size={24} />
              </div>
              <h3 className="text-lg font-bold text-nebula-text">Integrated Solution</h3>
              <p className="text-xs text-nebula-muted leading-relaxed">Unified AIDC infrastructure, global low-latency networks, and comprehensive cloud management in one platform.</p>
            </div>

            <div className="saas-card p-6 flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-nebula-accent flex items-center justify-center">
                <Layers size={24} />
              </div>
              <h3 className="text-lg font-bold text-nebula-text">Cloud Integration</h3>
              <p className="text-xs text-nebula-muted leading-relaxed">Seamless cloud network integration enabling enterprises to embrace AI technologies with confidence.</p>
            </div>

            <div className="saas-card p-6 flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-nebula-accent flex items-center justify-center">
                <Workflow size={24} />
              </div>
              <h3 className="text-lg font-bold text-nebula-text">Global Expansion</h3>
              <p className="text-xs text-nebula-muted leading-relaxed">Empower your enterprise to scale internationally with intelligent computing infrastructure built for growth.</p>
            </div>
          </div>

          <div className="w-16 h-1.5 bg-nebula-accent rounded-full mt-4" />
        </div>
      )
    },
    {
      id: 2,
      title: "The Market Challenge",
      script: "The velocity of AI advancement is unprecedented. Organizations aren't just looking for tools; they're looking for an AI strategy that won't become obsolete in 6 months. Flexibility and speed are no longer options—they are the standard.",
      content: (
        <div className="flex flex-col items-start justify-center h-full px-12 space-y-8">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-4 py-1.5 bg-indigo-50 text-nebula-accent text-xs font-bold rounded-full tracking-wide"
          >
            MARKET DYNAMICS
          </motion.div>
          <motion.h2 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-[90px] font-extrabold leading-tight tracking-tight text-nebula-text max-w-4xl"
          >
            The Market Is <br />
            <span className="gradient-text-saas italic">Moving Fast.</span> <br />
            <span className="text-slate-300">You Need Speed.</span>
          </motion.h2>
          <div className="w-24 h-2 bg-nebula-accent rounded-full" />
        </div>
      )
    },
    {
      id: 3,
      title: "Core Questions",
      script: "We see three persistent roadblocks in enterprise AI. First: Unified Access. How do you integrate without lock-in? Second: Practical Value. How do you turn a chat-box into a business agent? Third: Governance. How do you deploy securely?",
      content: (
        <div className="grid grid-cols-2 gap-20 h-full p-20 items-center">
          <div className="space-y-6">
            <h2 className="text-8xl font-black leading-tight text-nebula-text">03 <br /><span className="text-nebula-accent text-6xl">Pillars</span></h2>
            <div className="w-full h-px bg-slate-200" />
            <p className="text-xl text-nebula-muted font-medium">Removing Friction in AI Adoption</p>
          </div>
          <div className="space-y-6">
            {[
              { q: "Unified Multi-Model Access", d: "Reach 140+ models via one secure endpoint" },
              { q: "Autonomous Business Agents", d: "Convert raw intelligence into automated task-flow" },
              { q: "Flexible Enterprise Control", d: "Deploy in your cloud, your VPN, your terms" }
            ].map((item, i) => (
              <motion.div 
                key={i}
                className="saas-card p-8 flex flex-col gap-2 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4 opacity-5 text-nebula-accent">
                   <Key size={60} />
                </div>
                <h3 className="text-xl font-bold text-nebula-text">{item.q}</h3>
                <p className="text-sm text-nebula-muted">{item.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 4,
      title: "The Approach",
      script: "Our architecture is optimized for speed and governance. We've built a three-layered stack that addresses the entire AI lifecycle. From the One-Key Access layer to the Agent Solution layer, and finally to the Enterprise Infrastructure layer, we ensure every part of your AI stack is performant and secure.",
      content: (
        <div className="flex flex-col h-full p-20 justify-center gap-16">
          <div className="text-center space-y-4">
             <div className="text-nebula-accent font-bold tracking-widest text-xs uppercase">The Architecture</div>
             <h2 className="text-6xl font-black">
               Our <span className="gradient-text-saas">Optimized Stack</span>
             </h2>
          </div>
          <div className="grid grid-cols-3 gap-8">
            {[
              { label: "Access Layer", icon: Key, desc: "Unified API Gateway" },
              { label: "Solution Layer", icon: Bot, desc: "Custom AI Agents" },
              { label: "Governance Layer", icon: ShieldCheck, desc: "Cloud & Hybrid Control" }
            ].map((layer, i) => (
              <div key={i} className="saas-card p-10 flex flex-col items-center group relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-500" />
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-nebula-accent flex items-center justify-center mb-8 group-hover:bg-nebula-accent group-hover:text-white transition-colors duration-300">
                  <layer.icon size={28} />
                </div>
                <div className="text-center relative z-10">
                  <div className="text-sm font-bold text-nebula-muted mb-2">LAYER 0{i+1}</div>
                  <div className="text-2xl font-black text-nebula-text mb-4">{layer.label}</div>
                  <p className="text-xs text-nebula-muted">{layer.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 5,
      title: "Market Entry",
      script: "Starting with Nebula is frictionless. Many clients begin with our Unified Model Access to replace multiple subscriptions with one clear enterprise account. As internal technical debt grows, they move toward Bespoke Agents and Scalable Infrastructure nodes.",
      content: (
        <div className="flex items-center justify-center h-full p-20">
          <div className="relative w-full max-w-5xl aspect-video saas-card bg-slate-900 border-none overflow-hidden flex flex-col items-center justify-center p-12 text-center text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.15),transparent)] pointer-events-none" />
            <div className="flex items-center gap-4 text-xs font-bold text-indigo-400 mb-8 tracking-widest uppercase">
               <Globe size={16} />
               <span>Gateway Entry Points</span>
            </div>
            <h2 className="text-6xl font-black mb-12 max-w-3xl leading-tight">
               One Gateway to <br />
               <span className="text-indigo-400 italic">Scale Your Productivity</span>
            </h2>
            
            <div className="grid grid-cols-4 gap-4 w-full">
              {[
                { title: "SaaS Ops", val: "99.9% Uptime" },
                { title: "Bespoke Agents", val: "Custom Logic" },
                { title: "Hybrid Node", val: "On-Prem Ready" },
                { title: "Global AIDC", val: "Scalable Net" }
              ].map((item, i) => (
                <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-xl hover:bg-white/10 transition-colors">
                   <div className="text-[10px] text-white/40 font-bold uppercase mb-1">{item.title}</div>
                   <div className="text-sm font-bold text-white tracking-tight">{item.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 6,
      title: "140+ Models",
      script: "Our model hub is the core of the gateway. We maintain high-availability connections to every major provider. This means you can hot-swap models based on cost, latency, or quality without rewriting a single line of your application glue code.",
      content: (
        <div className="flex flex-col items-center h-full p-20 justify-center">
          <div className="text-center mb-16 space-y-4">
            <div className="text-indigo-600 font-black text-sm uppercase tracking-widest">
              The Gateway Hub
            </div>
            <h2 className="text-7xl font-extrabold tracking-tighter">
              140+ Models.{" "}
              <span className="gradient-text-saas italic">One Endpoint.</span>
            </h2>
          </div>

          <div className="grid grid-cols-4 gap-6 w-full max-w-5xl">
            {[
              { name: "CLAUDE 4.6 Sonnet", prov: "anthropic", speed: "High" },
              { name: "GEMINI 3.1 Pro", prov: "google", speed: "Instant" },
              { name: "GPT-5.2 Pro", prov: "openai", speed: "Balanced" },
              { name: "QWEN 3.5 Plus", prov: "alibaba", speed: "Open" },
            ].map((model, i) => (
              <div
  key={i}
  className="saas-card p-10 flex flex-col items-center gap-6 group hover:-translate-y-2 transition-all hover:border-indigo-200 hover:shadow-xl"
>
  {/* Container for the logo */}
  <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center p-2 transition-all group-hover:bg-white group-hover:shadow-md">
    <img
      src={providerLogos[model.prov]}
      alt={model.prov}
      className="w-full h-full object-contain grayscale opacity-70 transition-all group-hover:grayscale-0 group-hover:opacity-100"
    />
  </div>

  <div className="text-center">
    <div className="text-xs font-bold text-nebula-text mb-1 transition-colors group-hover:text-indigo-600">
      {model.name}
    </div>
    <div className="text-[10px] text-nebula-muted font-bold uppercase tracking-widest">
      {model.prov}
    </div>
  </div>
</div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 7,
      title: "Impact",
      script: "We bridge the gap between engineering efficiency and business agility. For developers, we're the clean API layer that handles auth and failover. For the C-suite, we're the platform that enables low-friction experimentation and rapid time-to-market.",
      content: (
        <div className="grid grid-cols-2 gap-0 h-full">
          <div className="bg-slate-900 text-white p-24 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform duration-700">
               <Zap size={200} />
            </div>
            <div className="space-y-4">
              <div className="text-indigo-400 font-bold text-xs uppercase tracking-[0.2em]">Stakeholder Value</div>
              <h2 className="text-7xl font-black leading-none">Business <br /><span className="text-indigo-400 italic">Agility.</span></h2>
            </div>
            <div className="space-y-2 relative z-10">
              <div className="flex items-center gap-2 text-indigo-400">
                 <CheckCircle2 size={16} />
                 <span className="text-sm font-bold uppercase">Rapid Experimentation</span>
              </div>
              <p className="text-white/60 text-lg font-light">Reduce trial cycle from weeks to minutes.</p>
            </div>
          </div>
          <div className="p-24 flex flex-col justify-between bg-white relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:-rotate-12 transition-transform duration-700">
               <Cpu size={200} />
            </div>
            <div className="space-y-4">
              <div className="text-nebula-accent font-bold text-xs uppercase tracking-[0.2em]">Engineering Value</div>
              <h2 className="text-7xl font-black leading-none text-nebula-text">Unified <br /><span className="gradient-text-saas italic">Standard.</span></h2>
            </div>
            <div className="space-y-2 relative z-10">
              <div className="flex items-center gap-2 text-nebula-accent">
                 <CheckCircle2 size={16} />
                 <span className="text-sm font-bold uppercase">Clean Architecture</span>
              </div>
              <p className="text-nebula-muted text-lg font-light">One SDK. Zero technical debt from provider hotswapping.</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 8,
      title: "Operations",
      script: "Embedding AI into the workflow is where the real value lies. Our operations suite covers common business tasks out of the box, while allowing for bespoke engineering where needed. We handle the heavy lifting of document parsing and workflow orchestration so you can focus on the business logic.",
      content: (
        <div className="flex flex-col h-full p-24 justify-center">
          <div className="flex justify-between items-end mb-16">
            <div className="space-y-4">
               <div className="text-indigo-600 font-black text-xs uppercase tracking-widest">Solutions Suite</div>
               <h2 className="text-6xl font-black">AI-Powered <br /><span className="gradient-text-saas italic">Operations</span></h2>
            </div>
            <div className="text-right">
               <div className="text-3xl font-black text-nebula-text">92%</div>
               <div className="text-[10px] text-nebula-muted uppercase font-bold tracking-widest">Automation Efficiency</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-6">
            {[
              { t: "Knowledge Assistants", i: MessageSquare },
              { t: "Document Intelligence", i: FileText },
              { t: "Customer Copilots", i: Users },
              { t: "Orchestration Engines", i: Workflow }
            ].map((item, i) => (
              <div key={i} className="saas-card p-8 flex items-center justify-between group cursor-pointer hover:border-indigo-600">
                <div className="flex items-center gap-6">
                   <div className="w-12 h-12 rounded-xl bg-slate-50 text-nebula-text flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <item.i size={24} />
                   </div>
                   <span className="text-xl font-bold text-nebula-text">{item.t}</span>
                </div>
                <ArrowRight className="text-indigo-600 translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 9,
      title: "Deployment",
      script: "Control is a non-negotiable for enterprise and public-sector clients. Nebula offers full-stack deployment flexibility. Whether you need a fully managed cloud solution, a private VPC tunnel, or a high-performance hybrid node integrated with our global AIDC network, we deliver the governance you need.",
      content: (
        <div className="flex flex-col h-full p-24 justify-center gap-12">
          <div className="max-w-2xl">
            <div className="text-indigo-600 font-black text-xs uppercase tracking-widest mb-4">Enterprise Control</div>
            <h2 className="text-7xl font-extrabold leading-[0.9] tracking-tighter">
              Deployment
              <span className="block mt-4 gradient-text-saas">
                Is Governance.
              </span>
            </h2>
          </div>
          
          <div className="grid grid-cols-3 gap-6">
            {[
              { type: "Managed", desc: "Nebula Public Cloud" },
              { type: "Private", desc: "Your AWS/GCP/VPC" },
              { type: "Hybrid", desc: "On-Prem Gateway" }
            ].map((item, i) => (
              <div key={i} className="saas-card p-10 group cursor-pointer border-2 border-transparent hover:border-indigo-600">
                <div className="text-[10px] font-bold text-indigo-600 mb-6 uppercase tracking-widest">Model 0{i+1}</div>
                <div className="text-3xl font-black mb-4">{item.type}</div>
                <p className="text-sm text-nebula-muted leading-relaxed font-medium">{item.desc}</p>
                <div className="mt-8 pt-8 border-t border-slate-50 flex justify-between items-center opacity-40 group-hover:opacity-100 transition-opacity">
                   <Cloud size={20} />
                   <ArrowRight size={20} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 10,
      title: "Sectors",
      script: "Our foundation is industry-agnostic, supporting diverse business outcomes. In Public Sector and BUMN, we focus on secure knowledge graphs and automated citizen service review. In Private Enterprise, we drive sales enablement and high-latency customer support transformations.",
      content: (
        <div className="grid grid-cols-2 h-full gap-8 p-12">
           <div className="saas-card p-12 flex flex-col justify-between bg-[linear-gradient(135deg,rgba(99,102,241,0.02),transparent)]">
              <div className="space-y-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                   <ShieldCheck size={28} />
                </div>
                <h3 className="text-4xl font-extrabold">Public <br />Sector</h3>
                <div className="space-y-3">
                  {["Secure Knowledge Access", "Document Audit Logs", "Citizen Service Automation"].map((f, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm font-medium text-nebula-muted">
                        <div className="w-1 h-1 rounded-full bg-indigo-400" />
                        <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="text-sm font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2 group italic">
                 Explore Use Cases <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </button>
           </div>
           <div className="saas-card p-12 flex flex-col justify-between">
              <div className="space-y-6">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-nebula-text">
                   <Bot size={28} />
                </div>
                <h3 className="text-4xl font-extrabold">Private <br />Enterprise</h3>
                <div className="space-y-3">
                  {["Sales Copilots", "Internal Workflow Bot", "Customer Intent Support"].map((f, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm font-medium text-nebula-muted">
                        <div className="w-1 h-1 rounded-full bg-slate-400" />
                        <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="text-sm font-bold text-nebula-text uppercase tracking-widest flex items-center gap-2 group italic">
                 View Enterprise Roadmap <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </button>
           </div>
        </div>
      )
    },
    {
      id: 11,
      title: "Start Path",
      script: "We've engineered a low-friction entry path. We don't ask for a long-term commitment on day one. We start with a single priority use-case. Within 4 to 6 weeks, we run a focused pilot to validate performance, security, and ROI. Only after a successful pilot do we scale to a full enterprise integration.",
      content: (
        <div className="flex flex-col items-center justify-center h-full p-24 gap-20">
          <div className="text-center space-y-4">
             <div className="text-indigo-600 font-black text-xs uppercase tracking-widest">Onboarding</div>
             <h2 className="text-7xl font-extrabold tracking-tighter">The Path to <span className="gradient-text-saas">Scale</span></h2>
          </div>
          
          <div className="flex items-center gap-4 w-full max-w-5xl">
            {[
              { label: "01. Identify", desc: "Use Case Engineering" },
              { label: "02. Pilot", desc: "4-Week POC Validation" },
              { label: "03. Scale", desc: "Full Node Deployment" }
            ].map((step, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-8 group">
                <div className="saas-card w-full p-10 text-center relative hover:bg-slate-900 hover:text-white transition-all duration-500">
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-white text-indigo-600 border border-slate-100 rounded-full text-[10px] font-black group-hover:border-slate-800 transition-colors">STEP {i+1}</div>
                  <h3 className="text-2xl font-black mb-2">{step.label.split('.')[1]}</h3>
                  <p className="text-xs font-bold opacity-40 uppercase tracking-widest">{step.desc}</p>
                </div>
                {i < 2 && <ArrowRight className="text-slate-200 hidden" />}
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 12,
      title: "DEMO Showcase",
      script: "It's time to move from slides to source code. The following demo will showcase how our gateway handles a real-world multi-model workflow. You'll see unified authentication, intent-based model selection, and the speed of our integrated global network.",
      content: (
        <div className="flex items-center justify-center h-full text-center p-24 relative bg-slate-900 rounded-[2rem] m-12 overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.2),transparent)] opacity-50" />
          <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none p-12 overflow-hidden flex flex-wrap gap-4 font-mono text-[8px] text-white">
             {Array.from({length: 400}).map((_, i) => <span key={i}>AI_PIPELINE_INIT_0x23901A</span>)}
          </div>
          <div className="space-y-12 z-10 max-w-4xl">
             <div className="w-16 h-1 rounded-full bg-indigo-500 mx-auto" />
             <h2 className="text-[120px] font-black leading-[0.8] mb-8 text-white tracking-tighter">
                Initiate <br />
                <span className="text-indigo-400 italic">Live Gateway</span>
             </h2>
             <div className="flex flex-col items-center gap-6">
                <p className="text-2xl font-light text-white/40 leading-relaxed max-w-2xl px-12">
                  Showcasing sub-second model hotswapping and autonomous workflow orchestration.
                </p>
                <button 
                  className="bg-indigo-600 text-white px-16 py-6 rounded-2xl font-black text-xs uppercase tracking-[0.3em] hover:bg-white hover:text-indigo-600 transition-all duration-300 shadow-[0_0_50px_rgba(99,102,241,0.3)] hover:shadow-[0_0_70px_rgba(255,255,255,0.2)]"
                  onClick={() => window.open('https://ai-nebula.com/', '_blank')}
                >
                  Launch Showcase
                </button>
             </div>
          </div>
        </div>
      )
    }
  ];

  const nextSlide = useCallback(() => {
    if (currentSlide < slides.length - 1) {
      setDirection(1);
      setCurrentSlide(prev => prev + 1);
    }
  }, [currentSlide, slides.length]);

  const prevSlide = useCallback(() => {
    if (currentSlide > 0) {
      setDirection(-1);
      setCurrentSlide(prev => prev - 1);
    }
  }, [currentSlide]);

  const captureAllSlides = useCallback(async () => {
    const slideImages: Array<{ slide: Slide; dataUrl: string }> = [];

    for (const slide of slides) {
      const dataUrl = await captureSlideAsImage(slide);
      slideImages.push({ slide, dataUrl });
    }

    return slideImages;
  }, [slides]);

  const downloadPdf = useCallback(async () => {
    if (exportFormat) return;
    setExportFormat('pdf');

    try {
      const slideImages = await captureAllSlides();
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [SLIDE_EXPORT_WIDTH, SLIDE_EXPORT_HEIGHT],
        compress: true,
      });

      slideImages.forEach(({ dataUrl }, index) => {
        if (index > 0) {
          pdf.addPage([SLIDE_EXPORT_WIDTH, SLIDE_EXPORT_HEIGHT], 'landscape');
        }
        pdf.addImage(dataUrl, 'PNG', 0, 0, SLIDE_EXPORT_WIDTH, SLIDE_EXPORT_HEIGHT, undefined, 'FAST');
      });

      pdf.save('Nebula_Presentation.pdf');
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setExportFormat(null);
    }
  }, [captureAllSlides, exportFormat]);

  const downloadPptx = useCallback(async () => {
    if (exportFormat) return;
    setExportFormat('pptx');

    try {
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = 'Nebula';
      pptx.company = 'Nebula Data Solutions';
      pptx.subject = 'Nebula Presentation';
      pptx.title = 'Nebula Presentation';

      const slideImages = await captureAllSlides();

      slideImages.forEach(({ slide, dataUrl }) => {
        const pptxSlide = pptx.addSlide();
        pptxSlide.background = { fill: 'FFFFFF' };
        pptxSlide.addImage({
          data: dataUrl,
          x: 0, y: 0, w: PPTX_EXPORT_WIDTH, h: PPTX_EXPORT_HEIGHT,
        });

        if (slide.script) {
          pptxSlide.addNotes(slide.script);
        }
      });

      await pptx.writeFile({ fileName: 'Nebula_Presentation.pptx' });
    } catch (err) {
      console.error('PPTX generation failed:', err);
      alert('Failed to generate PPTX. Please try again.');
    } finally {
      setExportFormat(null);
    }
  }, [captureAllSlides, exportFormat]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Space') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === 'n') setShowNotes(prev => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  return (
    <div className="flex h-screen bg-nebula-bg text-nebula-text overflow-hidden no-print">
      {/* Sidebar Navigation */}
      <aside className={`w-48 h-full bg-nebula-sidebar border-r border-slate-200 flex flex-col p-6 gap-6 z-50 transition-transform ${isFullscreen ? '-translate-x-full absolute' : 'translate-x-0 relative'}`}>
        <div className="mb-4">
           <img src="nebula_logo.png" alt="Nebula Data" className="w-full h-auto object-contain" referrerPolicy="no-referrer" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-nebula-muted mb-2 font-black">Slides</div>
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              onClick={() => {
                setDirection(i > currentSlide ? 1 : -1);
                setCurrentSlide(i);
              }}
              className={`w-full aspect-video rounded-sm p-3 flex flex-col justify-between text-left transition-all group border ${
                i === currentSlide 
                ? 'border-nebula-accent bg-white shadow-xl opacity-100' 
                : 'border-slate-100 bg-white/50 opacity-50 hover:opacity-100 hover:border-slate-300'
              }`}
            >
              <div className={`w-3 h-[1px] ${i === currentSlide ? 'bg-nebula-accent translate-x-1' : 'bg-slate-300'} transition-all`} />
              <div className="text-[9px] serif italic leading-tight group-hover:text-nebula-accent truncate">
                {slide.title}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-auto pt-6 border-t border-slate-200">
          <div className="flex items-center gap-2 text-[8px] uppercase tracking-widest text-nebula-muted font-black">
            <div className={`w-1.5 h-1.5 rounded-full ${showNotes ? 'bg-green-500' : 'bg-slate-300'}`}></div>
            <span>{showNotes ? "Presenter Active" : "Private Feed"}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,rgba(37,99,235,0.03),transparent)] ${isFullscreen ? 'ml-0' : ''}`}>
        {/* Header */}
        <nav className={`h-16 border-b border-slate-200 flex items-center justify-between px-12 shrink-0 z-40 bg-white/80 backdrop-blur-md transition-transform ${isFullscreen ? '-translate-y-full absolute w-full' : 'translate-y-0 relative'}`}>
          <div className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40">
            NEBULA // <span className="italic serif text-nebula-accent capitalize tracking-normal">Group 2026</span>
          </div>
          <div className="flex gap-10 text-[9px] uppercase tracking-widest font-black text-nebula-muted items-center">
            <span className={currentSlide === 0 ? "text-nebula-accent" : ""}>Company</span>
            <span className={currentSlide > 0 && currentSlide <= 5 ? "text-nebula-accent" : ""}>Strategy</span>
            <span className={currentSlide > 5 && currentSlide <= 8 ? "text-nebula-accent" : ""}>Impact</span>
            <span className={currentSlide > 8 ? "text-nebula-accent" : ""}>Timeline</span>
            
            <div className="w-px h-4 bg-slate-200 mx-2" />
            
            <button 
              onClick={toggleFullscreen}
              className="flex items-center gap-2 hover:text-nebula-accent transition-colors group"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize size={14} className="group-hover:scale-110 transition-transform" /> : <Maximize size={14} className="group-hover:scale-110 transition-transform" />}
              <span>{isFullscreen ? 'EXIT' : 'PRESENT'}</span>
            </button>
            
            <div className="w-px h-4 bg-slate-200 mx-1" />

            <button 
              onClick={downloadPptx}
              disabled={exportFormat !== null}
              className="flex items-center gap-2 hover:text-nebula-accent transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download PowerPoint"
            >
              <FileText size={14} className="group-hover:scale-110 transition-transform" />
              <span>{exportFormat === 'pptx' ? 'PPTX...' : 'PPTX'}</span>
            </button>
            
            <div className="w-px h-4 bg-slate-200 mx-1" />
            
            <button 
              onClick={downloadPdf}
              disabled={exportFormat !== null}
              className="flex items-center gap-2 hover:text-nebula-accent transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download PDF"
            >
              <Download size={14} className="group-hover:scale-110 transition-transform" />
              <span>{exportFormat === 'pdf' ? 'PDF...' : 'PDF'}</span>
            </button>
          </div>
        </nav>

        {/* Slide Display */}
        <section className="flex-1 relative overflow-hidden">
          <AnimatePresence initial={false} mode="wait" custom={direction}>
            <motion.div
              key={currentSlide}
              custom={direction}
              initial={{ x: direction > 0 ? '100%' : '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: direction > 0 ? '-100%' : '100%', opacity: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 35 }}
              className="absolute inset-0"
            >
              {slides[currentSlide].content}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* Footer */}
        <footer className={`h-16 border-t border-slate-200 flex items-center justify-between px-12 shrink-0 text-[10px] uppercase tracking-widest text-nebula-muted font-black z-40 bg-white/80 backdrop-blur-md transition-transform ${isFullscreen ? 'translate-y-full absolute bottom-0 w-full' : 'translate-y-0 relative'}`}>
          <div>&copy; 2026 // NEBULA DATA SOLUTIONS</div>
          <div className="flex items-center gap-6">
            <div className="flex h-[2px] w-48 bg-slate-200 rounded-full overflow-hidden">
              <motion.div 
                animate={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
                className="bg-nebula-accent" 
              />
            </div>
            <span className="text-nebula-text w-12 text-right tracking-[0.2em] font-black">0{currentSlide + 1} / {slides.length}</span>
          </div>
        </footer>

        {/* Presenter Notes Modal */}
        <AnimatePresence>
          {showNotes && (
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="absolute bottom-16 inset-x-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 p-12 h-[35%] z-[60] shadow-2xl"
            >
              <div className="max-w-4xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="serif text-nebula-accent italic text-3xl">Note</span>
                    <div className="accent-line" />
                  </div>
                  <button onClick={() => setShowNotes(false)} className="text-[10px] uppercase tracking-widest font-black opacity-40 hover:opacity-100">Dismiss</button>
                </div>
                <p className="text-3xl font-light text-slate-600 leading-relaxed italic pr-20 serif">
                  {slides[currentSlide].script}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #2563EB; }
      `}</style>
    </div>
  );
}

// Custom Icons
function Building2({ size, className }: { size: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <rect width="8" height="18" x="2" y="4" rx="2"/><path d="M12 2v20"/><path d="M16 4h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M6 8h.01"/><path d="M6 12h.01"/><path d="M6 16h.01"/><path d="M18 8h.01"/><path d="M18 12h.01"/><path d="M18 16h.01"/>
    </svg>
  );
}