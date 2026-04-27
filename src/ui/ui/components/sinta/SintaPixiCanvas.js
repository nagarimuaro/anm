import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

const SintaPixiCanvas = () => {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const spriteRef = useRef(null);
  const texturesRef = useRef({});

  useEffect(() => {
    let isMounted = true;

    const initPixi = async () => {
      const app = new PIXI.Application();
      
      // Inisialisasi app agar otomatis mengikuti ukuran parent container
      await app.init({
        resizeTo: containerRef.current,
        backgroundAlpha: 0, // Transparent background
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        powerPreference: 'high-performance',
        autoDensity: true,
      });

      if (!isMounted) {
        app.destroy(true, { children: true, texture: true, baseTexture: true });
        return;
      }

      appRef.current = app;
      
      app.canvas.style.position = 'absolute';
      app.canvas.style.top = '0';
      app.canvas.style.left = '0';
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.filter = 'drop-shadow(0 20px 48px rgba(0,0,0,0.4))';
      app.canvas.style.pointerEvents = 'none';

      if (containerRef.current) {
        containerRef.current.appendChild(app.canvas);
      }

      try {
        texturesRef.current = {
          idle: await PIXI.Assets.load('/assets/karakter/SINTA.png'),
          A: await PIXI.Assets.load('/assets/karakter/SINTA_A.png'),
          E: await PIXI.Assets.load('/assets/karakter/SINTA_E.png'),
          I: await PIXI.Assets.load('/assets/karakter/SINTA_I.png'),
          O: await PIXI.Assets.load('/assets/karakter/SINTA_O.png'),
          U: await PIXI.Assets.load('/assets/karakter/SINTA_U.png'),
        };

        if (!isMounted) return;

        const sprite = new PIXI.Sprite(texturesRef.current.idle);
        sprite.anchor.set(0.5, 0); // Anchor top-center
        
        app.stage.addChild(sprite);
        spriteRef.current = sprite;

        // Fungsi untuk menyesuaikan ukuran sprite dengan layar
        const resizeSprite = () => {
          if (!spriteRef.current || !app.screen) return;
          
          // Posisikan di tengah atas
          spriteRef.current.x = app.screen.width / 2;
          spriteRef.current.y = 0;
          
          // Scale sprite agar tingginya pas dengan tinggi container (110vh)
          const scale = app.screen.height / spriteRef.current.texture.height;
          spriteRef.current.scale.set(scale);
        };

        // Panggil sekali di awal
        resizeSprite();

        // Listen event resize dari PIXI untuk mengatur ulang sprite
        app.renderer.on('resize', resizeSprite);

        let toggleViseme = false;
        let tickCount = 0;
        let lastViseme = 'idle';
        let framesSinceLastChange = 0;

        app.ticker.add(() => {
          const rms = window.currentVoiceRMS || 0;
          const detectedPhoneme = window.currentPhoneme || 'idle';
          
          tickCount++;
          framesSinceLastChange++;
          
          let targetViseme = 'idle';
          
          // Jika suara cukup keras (sedang bicara)
          if (rms > 200) {
             targetViseme = detectedPhoneme !== 'idle' ? detectedPhoneme : 'A';
          }

          let currentViseme = lastViseme;
          
          // Mencegah bibir bergetar terlalu cepat (chatter)
          if (targetViseme !== lastViseme) {
            // Tahan frame selama minimal 5 frame (~80ms)
            // KECUALI jika kembali ke 'idle' (mulut harus cepat nutup di akhir kata)
            if (framesSinceLastChange > 5 || targetViseme === 'idle') {
              currentViseme = targetViseme;
              lastViseme = targetViseme;
              framesSinceLastChange = 0;
              
              if (targetViseme !== 'idle') {
                toggleViseme = !toggleViseme;
              }
            }
          }

          if (spriteRef.current && texturesRef.current[currentViseme]) {
            if (spriteRef.current.texture !== texturesRef.current[currentViseme]) {
              spriteRef.current.texture = texturesRef.current[currentViseme];
              resizeSprite();
            }
          }
        });

      } catch (err) {
        console.error("Failed to load Pixi textures:", err);
      }
    };

    initPixi();

    return () => {
      isMounted = false;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '110vh', // Tinggi yang diinginkan untuk karakter
        pointerEvents: 'none'
      }}
    />
  );
};

export default SintaPixiCanvas;
