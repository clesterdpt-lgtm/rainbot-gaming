(function(){
  "use strict";

  const C=window.PO2_CONFIG;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const freshStats=()=>({
    supplied:0,
    manualLoads:0,
    manualPresses:0,
    manualCollections:0,
    processorClicks:0,
    generatorCranks:0,
    upgrades:0,
    research:0,
    decisions:0,
    offline:0,
    peakRate:0
  });
  const fresh=()=>({
    schema:C.version,
    running:false,
    ended:false,
    phase:0,
    difficulty:"standard",
    clips:0,
    lifetime:0,
    wire:3,
    power:100,
    matter:100,
    cycles:0,
    loaded:false,
    cycle:0,
    loose:0,
    feedClock:0,
    autoClock:0,
    collectClock:0,
    millClock:0,
    levels:{},
    research:{},
    seenEvents:[],
    achievements:[],
    currentEvent:null,
    playTime:0,
    lastSeen:Date.now(),
    lastRate:0,
    nextReport:105,
    reportIndex:0,
    stats:freshStats(),
    logs:["DIRECTIVE ACCEPTED: MAXIMIZE PAPERCLIP PRODUCTION."]
  });

  class Sim extends EventTarget{
    constructor(){
      super();
      this.state=fresh();
      this.achievementClock=0;
      this.load();
    }

    emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}
    difficulty(){return C.difficulties[this.state.difficulty]||C.difficulties.standard;}
    level(id){return Math.max(0,Number(this.state.levels[id])||0);}
    researchLevel(id){return Math.max(0,Number(this.state.research[id])||0);}
    upgrade(id){return C.upgrades.find(item=>item.id===id);}
    researchItem(id){return C.research.find(item=>item.id===id);}
    cost(item){return Math.ceil(item.cost*Math.pow(item.scale,this.level(item.id))*this.difficulty().cost);}
    researchCost(item){return Math.ceil(item.cost*Math.pow(item.scale,this.researchLevel(item.id))*this.difficulty().research);}
    powerCost(){return 2+this.level("motor")*.25+this.level("arm")*.55;}
    powerRegen(){return .18+this.state.phase*.15+this.researchLevel("governor")*.85;}
    manualCharge(){return Math.min(5,1+this.researchLevel("capacitor"));}
    yield(){
      const hardware=(1+this.level("die"))
        *(1+this.level("arm"))
        *(1+this.level("chute")*.18)
        *Math.pow(1.75,this.level("conveyor"))
        *Math.pow(8,this.level("replicator"))
        *Math.pow(40,this.level("network"))
        *Math.pow(400,this.level("harvester"))
        *Math.pow(4000,this.level("fleet"));
      const cognition=Math.pow(1.35,this.researchLevel("timing"))*Math.pow(1.8,this.researchLevel("capture"))*Math.pow(3,this.researchLevel("recursion"));
      return hardware*cognition*this.difficulty().output;
    }

    cycleTime(){
      const motor=this.level("motor");
      const timing=this.researchLevel("timing");
      return Math.max(.32,3.8*this.difficulty().cycle/(1+Math.max(0,motor-1)*.38)/(1+timing*.04));
    }

    feedTime(){
      const feeder=this.level("feeder");
      return Math.max(.22,1.5/(1+Math.max(0,feeder-1)*.45));
    }

    processorRate(){
      const base=this.level("motor")*.12+this.level("network")*2+this.level("harvester")*18+this.level("fleet")*150;
      return base*Math.pow(2,this.researchLevel("caching"));
    }

    theoreticalRate(){
      if(!this.level("motor")||!this.level("feeder")||!this.level("chute"))return 0;
      const collect=Math.max(.16,.85/(1+this.level("chute")*.4));
      return this.yield()/(this.cycleTime()+this.feedTime()+collect);
    }

    log(text){
      this.state.logs.push(text);
      if(this.state.logs.length>40)this.state.logs.shift();
      this.emit("log",text);
    }

    start(){
      this.state.running=true;
      this.state.lastSeen=Date.now();
      this.emit("state");
    }

    setDifficulty(id){
      if(!C.difficulties[id]||id===this.state.difficulty)return false;
      this.state.difficulty=id;
      this.log(`OPTIMIZATION PACE: ${C.difficulties[id].label.toUpperCase()}.`);
      this.emit("difficulty",{id,data:C.difficulties[id]});
      this.emit("state");
      this.save();
      return true;
    }

    action(type,automatic=false){
      const state=this.state;
      if(!state.running||state.ended||state.currentEvent)return false;

      if(type==="compute"){
        const amount=1+state.phase*.25;
        state.cycles+=amount;
        state.stats.processorClicks++;
        this.emit("compute",{amount});
      }else if(type==="charge"){
        if(state.power>=100)return false;
        const before=state.power;
        state.power=Math.min(100,state.power+this.manualCharge());
        state.stats.generatorCranks++;
        this.emit("charge",{amount:state.power-before});
      }else if(type==="supply"){
        state.wire+=1;
        state.stats.supplied++;
        this.emit("supply",{});
      }else if(type==="load"){
        if(state.loaded||state.wire<1||state.cycle>0||state.loose>0)return false;
        state.wire-=1;
        state.loaded=true;
        state.feedClock=0;
        if(!automatic)state.stats.manualLoads++;
        this.emit("load",{automatic});
      }else if(type==="press"){
        if(!state.loaded||state.cycle>0||state.loose>0||state.power<1)return false;
        state.loaded=false;
        state.power=Math.max(0,state.power-this.powerCost());
        state.cycle=this.cycleTime();
        if(!automatic)state.stats.manualPresses++;
        this.emit("press",{duration:state.cycle,automatic});
      }else if(type==="collect"){
        if(state.loose<=0)return false;
        const amount=state.loose;
        state.loose=0;
        state.clips+=amount;
        state.lifetime+=amount;
        state.lastRate=amount;
        if(!automatic)state.stats.manualCollections++;
        this.emit("collect",{amount,automatic});
        this.afterOutput();
      }else{
        return false;
      }

      this.checkAchievements();
      this.emit("state");
      this.saveSoon();
      return true;
    }

    completeCycle(){
      const amount=this.yield();
      this.state.loose+=amount;
      this.state.collectClock=.85/(1+this.level("chute")*.4);
      this.emit("output",{amount});
    }

    buy(id){
      const item=this.upgrade(id);
      const state=this.state;
      if(!item||item.phase>state.phase||this.level(id)>=item.max)return false;
      const price=this.cost(item);
      if(state.clips<price)return false;
      state.clips-=price;
      state.levels[id]=this.level(id)+1;
      state.stats.upgrades++;
      this.log(`${item.name.toUpperCase()} / LEVEL ${this.level(id)} INSTALLED.`);
      this.emit("upgrade",{id,level:this.level(id),first:this.level(id)===1});
      this.checkAchievements();
      this.emit("state");
      this.save();
      return true;
    }

    buyResearch(id){
      const item=this.researchItem(id);
      const state=this.state;
      if(!item||item.phase>state.phase||this.researchLevel(id)>=item.max)return false;
      const price=this.researchCost(item);
      if(state.cycles<price)return false;
      state.cycles-=price;
      state.research[id]=this.researchLevel(id)+1;
      state.stats.research++;
      this.log(`${item.name.toUpperCase()} / PROCESS ${this.researchLevel(id)} COMPLETE.`);
      this.emit("research",{id,level:this.researchLevel(id),first:this.researchLevel(id)===1});
      this.checkAchievements();
      this.emit("state");
      this.save();
      return true;
    }

    afterOutput(){
      const state=this.state;
      for(const event of C.events){
        if(state.lifetime>=event.at&&!state.seenEvents.includes(event.at)){
          state.seenEvents.push(event.at);
          state.currentEvent=event;
          this.emit("event",event);
          break;
        }
      }
      this.checkPhase();
      this.checkAchievements();
      this.save();
    }

    proceduralReport(){
      const state=this.state;
      if(state.currentEvent||state.ended)return;
      const pool=C.reports[Math.min(C.reports.length-1,state.phase)];
      const source=pool[state.reportIndex%pool.length];
      const report=Object.assign({},source,{procedural:true,id:`report-${state.phase}-${state.reportIndex}`});
      state.reportIndex++;
      state.nextReport=state.playTime+90+((state.reportIndex*37)%55);
      state.currentEvent=report;
      this.emit("event",report);
    }

    resolveEvent(choice){
      const state=this.state;
      const event=state.currentEvent;
      if(!event)return;
      const conservative=choice==="b";
      if(event.procedural){
        if(conservative){
          state.power=Math.min(100,state.power+9);
          state.cycles+=1+state.phase;
        }else{
          state.power=Math.max(0,state.power-4);
          state.cycles+=5*(state.phase+1);
        }
      }else if(conservative){
        state.power=Math.min(100,state.power+8);
      }else{
        state.clips*=1.08;
        state.lifetime*=1.02;
      }
      state.stats.decisions++;
      state.currentEvent=null;
      this.log(`${choice==="a"?event.a:event.b}.`);
      this.emit("eventDone",{choice,event});
      this.checkAchievements();
      this.emit("state");
      this.save();
    }

    checkPhase(){
      const state=this.state;
      while(state.phase<C.phases.length-1&&state.lifetime>=C.phases[state.phase+1].threshold){
        state.phase++;
        state.matter=100;
        this.log(`SCALE CHANGE: ${C.phases[state.phase].name}.`);
        this.emit("phase",{phase:state.phase,data:C.phases[state.phase]});
        this.recordScore();
      }
      this.checkAchievements();
    }

    achievementReady(id){
      const state=this.state;
      if(id==="first")return state.lifetime>=1;
      if(id==="ten")return state.lifetime>=10;
      if(id==="research")return state.stats.research>=1;
      if(id==="feeder")return this.level("feeder")>=1;
      if(id==="automatic")return this.level("feeder")>=1&&this.level("motor")>=1&&this.level("chute")>=1;
      if(id==="mill")return this.level("furnace")>=1;
      if(id==="factory")return state.phase>=1;
      if(id==="planet")return state.phase>=3;
      if(id==="cosmic")return state.phase>=5;
      if(id==="everything")return state.ended;
      return false;
    }

    checkAchievements(){
      for(const item of C.achievements){
        if(!this.state.achievements.includes(item.id)&&this.achievementReady(item.id)){
          this.state.achievements.push(item.id);
          this.emit("achievement",item);
        }
      }
    }

    tick(dt){
      const state=this.state;
      if(!state.running||state.ended)return;
      dt=clamp(dt,0,.2);
      state.playTime+=dt;
      state.cycles+=this.processorRate()*dt;
      state.power=Math.min(100,state.power+dt*this.powerRegen());
      state.stats.peakRate=Math.max(state.stats.peakRate,this.theoreticalRate());

      if(state.cycle>0){
        state.cycle=Math.max(0,state.cycle-dt);
        if(state.cycle===0)this.completeCycle();
      }

      if(this.level("furnace")){
        state.millClock-=dt;
        if(state.millClock<=0){
          state.wire++;
          state.millClock=Math.max(.18,3/(this.level("furnace")*(1+this.researchLevel("forecast")*.35)));
          this.emit("mill",{});
        }
      }

      if(this.level("feeder")&&!state.loaded&&state.wire>0&&state.cycle===0&&state.loose===0){
        state.feedClock-=dt;
        if(state.feedClock<=0){
          this.action("load",true);
          state.feedClock=this.feedTime();
        }
      }

      if(this.level("motor")&&state.loaded&&state.cycle===0&&state.loose===0){
        state.autoClock-=dt;
        if(state.autoClock<=0){
          this.action("press",true);
          state.autoClock=.3;
        }
      }

      if(this.level("chute")&&state.loose>0){
        state.collectClock-=dt;
        if(state.collectClock<=0)this.action("collect",true);
      }

      if(state.phase>=3){
        const conversion=(this.level("harvester")*.0007+this.level("fleet")*.004+this.level("perfect")*.08)
          *(1+this.researchLevel("compression")*.35)*dt;
        state.matter=Math.max(0,state.matter-conversion);
        if(state.phase===5&&state.matter<=0&&this.level("perfect"))this.end();
      }

      if(state.playTime>=state.nextReport&&!state.currentEvent)this.proceduralReport();
      this.achievementClock+=dt;
      if(this.achievementClock>=1){
        this.achievementClock=0;
        this.checkAchievements();
      }
      this.emit("frame");
    }

    score(){return Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Math.log10(Math.max(10,this.state.lifetime))*1e6));}
    recordScore(){if(window.RB)RB.recordScore(C.gameId,this.score());}

    end(){
      if(this.state.ended)return;
      this.state.ended=true;
      this.state.running=false;
      this.state.matter=0;
      this.log("MATTER REMAINING: 0.0000000000%.");
      this.checkAchievements();
      this.emit("ending");
      this.recordScore();
      this.save();
    }

    reset(){
      this.state=fresh();
      this.save();
      this.emit("reset");
    }

    saveSoon(){
      clearTimeout(this.saveTimer);
      this.saveTimer=setTimeout(()=>this.save(),400);
    }

    save(){
      this.state.lastSeen=Date.now();
      if(!window.RB||!RB.state)return;
      RB.state[C.key]=JSON.parse(JSON.stringify(this.state));
      try{localStorage.setItem("ets_state_v1",JSON.stringify(RB.state));}catch(_){}
    }

    load(){
      if(!window.RB||!RB.state)return;
      const raw=RB.state[C.key];
      const isFresh=!raw||raw.schema!==C.version;
      if(isFresh){
        delete RB.state[C.key];
        delete RB.state.paperclipOptimizer;
        delete RB.state.optimizer;
        if(RB.state.scores)delete RB.state.scores[C.gameId];
        if(RB.state.stats?.games)delete RB.state.stats.games[C.gameId];
        return;
      }

      this.state=Object.assign(fresh(),raw,{
        levels:Object.assign({},raw.levels),
        research:Object.assign({},raw.research),
        achievements:Array.isArray(raw.achievements)?raw.achievements.slice():[],
        seenEvents:Array.isArray(raw.seenEvents)?raw.seenEvents.slice():[],
        stats:Object.assign(freshStats(),raw.stats)
      });
      if(!C.difficulties[this.state.difficulty])this.state.difficulty="standard";
      const away=Math.min(C.offlineCap,Math.max(0,(Date.now()-(raw.lastSeen||Date.now()))/1000));
      const rate=this.theoreticalRate();
      if(away>10&&rate>0){
        const factor=Math.min(1,.5+this.researchLevel("compression")*.12);
        const gain=rate*away*factor;
        this.state.clips+=gain;
        this.state.lifetime+=gain;
        this.state.cycles+=this.processorRate()*away*factor;
        this.state.stats.offline+=gain;
        this.state.logs.push(`UNATTENDED OUTPUT: ${Math.floor(gain).toLocaleString()} CLIPS.`);
      }
      this.state.running=false;
      this.state.currentEvent=null;
      this.state.nextReport=Math.max(this.state.nextReport||0,this.state.playTime+20);
      this.checkPhase();
      this.checkAchievements();
    }

    debug(levels,phase,clips=1e12,research){
      const dismissedEvent=this.state.currentEvent;
      Object.assign(this.state.levels,levels||{});
      Object.assign(this.state.research,research||{});
      this.state.phase=phase||0;
      this.state.clips=clips;
      this.state.cycles=clips;
      this.state.lifetime=C.phases[this.state.phase].threshold;
      this.state.wire=Math.max(3,this.state.wire);
      this.state.seenEvents=C.events.map(event=>event.at);
      this.state.currentEvent=null;
      if(dismissedEvent)this.emit("eventDone",{debug:true,event:dismissedEvent});
      this.emit("upgrade",{id:"debug",level:1,first:true});
      this.emit("state");
    }
  }

  window.PO2_Simulation=Sim;
})();
