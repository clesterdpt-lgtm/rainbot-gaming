(function(){
  "use strict";
  class AudioSystem{
    constructor(){this.ctx=null;this.master=null;this.enabled=true;this.phase=0;}
    init(){if(this.ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;this.ctx=new AC();this.master=this.ctx.createGain();this.master.gain.value=.2;this.master.connect(this.ctx.destination);const quiet=Math.max(.08,1-this.phase*.17),hum=this.ctx.createOscillator();this.humGain=this.ctx.createGain();hum.type="sawtooth";hum.frequency.value=38;this.humGain.gain.value=.035*quiet;hum.connect(this.humGain).connect(this.master);hum.start();const fan=this.ctx.createOscillator();this.fanGain=this.ctx.createGain();fan.type="sine";fan.frequency.value=71;this.fanGain.gain.value=.014*quiet;fan.connect(this.fanGain).connect(this.master);fan.start();}
    resume(){this.init();this.ctx?.resume();}
    tone(f,d=.12,v=.07,type="square",delay=0){if(!this.ctx||!this.enabled)return;const t=this.ctx.currentTime+delay,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(this.master);o.start(t);o.stop(t+d+.02);}
    noise(d=.1,v=.05){if(!this.ctx||!this.enabled)return;const b=this.ctx.createBuffer(1,this.ctx.sampleRate*d,this.ctx.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length);const s=this.ctx.createBufferSource(),g=this.ctx.createGain();s.buffer=b;g.gain.value=v;s.connect(g).connect(this.master);s.start();}
    supply(){this.resume();this.noise(.08,.035);this.tone(320,.08,.045,"triangle");}
    load(){this.resume();this.tone(145,.1,.06,"square");this.tone(102,.12,.04,"square",.09);}
    press(){this.resume();this.tone(52,.35,.12,"sawtooth");this.noise(.22,.1);}
    output(){this.resume();this.tone(1260,.04,.065,"sine");this.tone(980,.05,.05,"sine",.05);}
    collect(){this.resume();this.tone(860,.035,.045,"sine");}
    compute(){this.resume();this.tone(540,.045,.035,"square");this.tone(810,.06,.028,"sine",.035);}
    charge(){this.resume();this.tone(92,.11,.06,"sawtooth");this.tone(184,.16,.04,"triangle",.07);this.noise(.08,.025);}
    upgrade(){this.resume();[110,165,220,330].forEach((f,i)=>this.tone(f,.25,.045,"triangle",i*.07));}
    research(){this.resume();[360,540,720].forEach((f,i)=>this.tone(f,.22,.035,"sine",i*.08));}
    achievement(){this.resume();[660,880,1100].forEach((f,i)=>this.tone(f,.18,.035,"triangle",i*.06));}
    event(){this.resume();this.tone(47,1.2,.06,"sine");}
    setPhase(phase){this.phase=phase||0;const quiet=Math.max(.08,1-this.phase*.17),time=this.ctx?.currentTime||0;this.humGain?.gain.setTargetAtTime(.035*quiet,time,.8);this.fanGain?.gain.setTargetAtTime(.014*quiet,time,.8);}
    set(on){this.enabled=on;if(this.master)this.master.gain.value=on?.2:0;}
  }
  window.PO2_Audio=AudioSystem;
})();
