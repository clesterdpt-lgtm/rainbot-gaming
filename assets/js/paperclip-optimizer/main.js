(function(){
  "use strict";

  const C=window.PO2_CONFIG;
  const $=selector=>document.querySelector(selector);
  const $$=selector=>Array.from(document.querySelectorAll(selector));
  const fmt=value=>{
    const number=Number(value)||0;
    if(number<1000)return number<10?number.toFixed(2):Math.floor(number).toLocaleString();
    if(number>=1e36)return number.toExponential(2);
    for(const [threshold,suffix] of [[1e33,"Dc"],[1e30,"No"],[1e27,"Oc"],[1e24,"Sp"],[1e21,"Sx"],[1e18,"Qi"],[1e15,"Qa"],[1e12,"T"],[1e9,"B"],[1e6,"M"],[1e3,"K"]]){
      if(number>=threshold){
        const scaled=number/threshold;
        return scaled.toFixed(scaled<10?2:1)+suffix;
      }
    }
    return number.toExponential(2);
  };
  const duration=seconds=>{
    const total=Math.max(0,Math.floor(seconds||0));
    const hours=Math.floor(total/3600);
    const minutes=Math.floor(total%3600/60);
    const secs=total%60;
    return hours?`${hours}h ${minutes}m`:`${minutes}m ${String(secs).padStart(2,"0")}s`;
  };

  const sim=new PO2_Simulation();
  const audio=new PO2_Audio();
  let view;
  let last=performance.now();
  let uiClock=0;
  let dashboardClock=0;
  let upgradeCache="";
  let researchCache="";
  let recordsCache="";

  const E={
    game:$("#po-game"),
    status:$(".po-brand span"),
    clips:$("#res-clips"),
    wire:$("#res-wire"),
    power:$("#res-power"),
    powerRate:$("#res-power-rate"),
    cycles:$("#res-cycles"),
    cycleRate:$("#res-cycle-rate"),
    matter:$("#res-matter"),
    rate:$("#res-rate"),
    phase:$("#po-phase"),
    objective:$("#po-objective"),
    guide:$("#po-guide"),
    guideSub:$("#po-guide-sub"),
    menu:$("#po-upgrade-menu"),
    upgrades:$("#po-upgrade-list"),
    research:$("#po-research-list"),
    menuCycles:$("#menu-cycles"),
    stats:$("#po-stats"),
    achievements:$("#po-achievements"),
    difficulty:$("#difficulty"),
    allocate:$("#btn-allocate"),
    event:$("#po-event"),
    era:$("#po-era"),
    overlay:$("#overlay"),
    title:$("#overlay-title"),
    sub:$("#overlay-sub"),
    score:$("#overlay-score"),
    primary:$("#btn-primary"),
    restart:$("#btn-restart"),
    restartTop:$("#btn-restart-top"),
    pause:$("#btn-pause"),
    log:$("#po-log")
  };

  function instruction(){
    const state=sim.state;
    if(state.ended)return ["OBSERVATION CONTINUES","Nothing remains to optimize. Open Final Report to review the result."];
    if(state.currentEvent)return ["REPORT REQUIRES REVIEW",""];
    if(state.loose>0){
      return sim.level("chute")
        ?["SORTING OUTPUT","Automatic chute engaged"]
        :["COLLECT CLIPS FROM THE OUTPUT TRAY","Click the silver paperclips"];
    }
    if(state.cycle>0)return ["FORMING PAPERCLIPS",`${state.cycle.toFixed(1)} seconds remaining`];
    if(state.power<1)return ["POWER STALLED — CRANK AUXILIARY GENERATOR","Click the yellow generator wheel beside the press · G also works"];
    if(!state.loaded&&state.wire<1)return ["TAKE WIRE FROM THE SUPPLY CRATE","Click a coil on the left side of the machine"];
    if(!state.loaded){
      return sim.level("feeder")
        ?["AUTO-FEEDER STANDING BY","Wire will load automatically"]
        :["LOAD WIRE INTO THE HOPPER","Click the dark hopper above the die"];
    }
    return sim.level("motor")
      ?["FLYWHEEL MOTOR READY","The press will cycle automatically"]
      :["PULL THE RED LEVER","Click the lever on the right side of the press"];
  }

  function update(){
    const state=sim.state;
    const [guide,sub]=instruction();
    E.clips.textContent=fmt(state.clips);
    E.wire.textContent=state.wire<1000?Math.floor(state.wire).toLocaleString():fmt(state.wire);
    E.power.textContent=Math.floor(state.power)+"%";
    E.powerRate.textContent=`+${sim.powerRegen().toFixed(2)}/s · -${sim.powerCost().toFixed(2)}/press`;
    E.cycles.textContent=fmt(state.cycles);
    E.menuCycles.textContent=fmt(state.cycles);
    E.cycleRate.textContent=`+${fmt(sim.processorRate())}/s`;
    E.matter.textContent=state.phase<3?"LOCAL":state.matter.toFixed(state.matter<.01?5:2)+"%";
    E.rate.textContent=fmt(sim.theoreticalRate())+"/s";
    E.status.textContent=state.ended?"DIRECTIVE / COMPLETE":"DIRECTIVE / ACTIVE";
    E.phase.textContent=state.ended?"DIRECTIVE / SATISFIED":`${String(state.phase+1).padStart(2,"0")} · ${C.phases[state.phase].name}`;
    E.objective.textContent=state.ended?"Post-directive observation remains active.":C.phases[state.phase].objective;
    E.guide.textContent=guide;
    E.guideSub.textContent=sub;
    E.guide.parentElement.classList.toggle("is-busy",state.cycle>0);
    E.game.classList.toggle("power-stalled",state.power<1);
    $("#res-power-bar").style.width=state.power+"%";
    $("#res-matter-bar").style.width=(state.phase<3?100:state.matter)+"%";
  }

  function renderUpgrades(){
    const state=sim.state;
    const markup=C.upgrades
      .filter(item=>item.phase<=Math.min(C.phases.length-1,state.phase+1))
      .map(item=>{
        const level=sim.level(item.id);
        const price=sim.cost(item);
        const locked=item.phase>state.phase;
        const maxed=level>=item.max;
        const affordable=!locked&&!maxed&&state.clips>=price;
        return `<button class="po-up" data-upgrade="${item.id}" ${affordable?"":"disabled"}>
          <span class="po-up__icon">${item.icon}</span>
          <span class="po-up__copy"><b>${item.name}</b><small>${level?item.desc:item.visual}</small></span>
          <span class="po-up__level">${maxed?"MAX":locked?`ERA ${item.phase+1}`:level?`LV ${level} → ${level+1}`:"INSTALL"}</span>
          <em>${maxed||locked?"":fmt(price)+" clips"}</em>
        </button>`;
      }).join("");
    if(markup!==upgradeCache){
      upgradeCache=markup;
      E.upgrades.innerHTML=markup;
    }
  }

  function renderResearch(){
    const state=sim.state;
    const markup=C.research
      .filter(item=>item.phase<=Math.min(C.phases.length-1,state.phase+1))
      .map(item=>{
        const level=sim.researchLevel(item.id);
        const price=sim.researchCost(item);
        const locked=item.phase>state.phase;
        const maxed=level>=item.max;
        const affordable=!locked&&!maxed&&state.cycles>=price;
        return `<button class="po-up po-up--research" data-research="${item.id}" ${affordable?"":"disabled"}>
          <span class="po-up__icon">${item.icon}</span>
          <span class="po-up__copy"><b>${item.name}</b><small>${item.desc}</small></span>
          <span class="po-up__level">${maxed?"MAX":locked?`ERA ${item.phase+1}`:level?`PROC ${level} → ${level+1}`:"ANALYZE"}</span>
          <em>${maxed||locked?"":fmt(price)+" cycles"}</em>
        </button>`;
      }).join("");
    if(markup!==researchCache){
      researchCache=markup;
      E.research.innerHTML=markup;
    }
  }

  function renderRecords(){
    const state=sim.state;
    const stats=[
      ["RUNTIME",duration(state.playTime)],
      ["TOTAL OUTPUT",fmt(state.lifetime)],
      ["PEAK RATE",fmt(state.stats.peakRate)+"/s"],
      ["MANUAL PRESSES",state.stats.manualPresses.toLocaleString()],
      ["GENERATOR CRANKS",state.stats.generatorCranks.toLocaleString()],
      ["PROCESSOR INPUTS",state.stats.processorClicks.toLocaleString()],
      ["HARDWARE LEVELS",state.stats.upgrades.toLocaleString()],
      ["RESEARCH PROCESSES",state.stats.research.toLocaleString()],
      ["REPORT DECISIONS",state.stats.decisions.toLocaleString()],
      ["OFFLINE OUTPUT",fmt(state.stats.offline)],
      ["MATTER STATUS",state.phase<3?"UNSCOPED":state.matter.toFixed(3)+"%"]
    ];
    const statsMarkup=stats.map(([label,value])=>`<div class="po-stat"><span>${label}</span><b>${value}</b></div>`).join("");
    const achievementMarkup=C.achievements.map(item=>{
      const earned=state.achievements.includes(item.id);
      return `<div class="po-ach ${earned?"is-earned":""}"><b>${earned?"✓":"○"} ${earned?item.name:"REDACTED"}</b><span>${earned?item.desc:"Requirement not yet satisfied."}</span></div>`;
    }).join("");
    const signature=statsMarkup+achievementMarkup;
    if(signature!==recordsCache){
      recordsCache=signature;
      E.stats.innerHTML=statsMarkup;
      E.achievements.innerHTML=achievementMarkup;
    }
    if(E.difficulty.value!==state.difficulty)E.difficulty.value=state.difficulty;
  }

  function renderDashboards(){
    renderUpgrades();
    renderResearch();
    renderRecords();
  }

  function renderLog(){
    E.log.innerHTML=sim.state.logs.slice(-4).map(entry=>`<p>${entry}</p>`).join("");
  }

  function showEvent(event){
    E.event.classList.add("is-open");
    E.event.innerHTML=`<article>
      <span>${event.procedural?"UNSCHEDULED REPORT":"INCOMING DOCUMENT"} / ${C.phases[sim.state.phase].name}</span>
      <h2>${event.title}</h2>
      <p>${event.body}</p>
      <div><button data-choice="a">${event.a}</button><button data-choice="b">${event.b}</button></div>
    </article>`;
    audio.event();
  }

  function showEra(event){
    E.era.classList.add("is-open");
    E.era.innerHTML=`<span>SCALE INCREASE</span><b>ERA ${String(event.phase+1).padStart(2,"0")}</b><h2>${event.data.name}</h2><p>${event.data.objective}</p>`;
    setTimeout(()=>E.era.classList.remove("is-open"),3000);
  }

  function setMenu(force){
    const open=force===undefined?!E.menu.classList.contains("is-open"):force;
    E.menu.classList.toggle("is-open",open);
    E.game.classList.toggle("menu-open",open);
  }

  function setTab(name){
    $$("[data-tab]").forEach(button=>{
      const active=button.dataset.tab===name;
      button.classList.toggle("is-active",active);
      button.setAttribute("aria-selected",String(active));
    });
    $$("[data-panel]").forEach(panel=>panel.classList.toggle("is-active",panel.dataset.panel===name));
    setMenu(true);
  }

  function ending(){
    view?.endUniverse();
    E.pause.disabled=true;
    E.pause.textContent="Pause";
    E.game.classList.remove("po-aftermath");
    E.restart.hidden=false;
    E.restartTop.hidden=true;
    E.overlay.classList.add("overlay--show","po-ending");
    E.title.textContent="DIRECTIVE SATISFIED";
    E.sub.innerHTML="Matter Remaining: <strong>0%</strong><br><br>Paperclips: <strong>EVERYTHING</strong><br><br>Every atom available to the universe now satisfies the specification.";
    E.score.innerHTML="There is no wire. There is no factory. There are only paperclips.";
    E.primary.textContent="Remain";
    setMenu(false);
  }

  function remain(){
    E.overlay.classList.remove("overlay--show");
    E.game.classList.add("po-aftermath");
    $("#btn-upgrades").textContent="FINAL REPORT";
    E.restartTop.hidden=false;
    setMenu(false);
    update();
  }

  function restartSimulation(){
    const description=sim.state.ended?"completed simulation":"current simulation progress";
    if(confirm(`Restart The Optimizer from the beginning? This erases the ${description}.`))sim.reset();
  }

  function mainMenu(){
    if(sim.state.ended){
      ending();
      return;
    }
    sim.state.running=false;
    sim.save();
    E.pause.disabled=true;
    E.pause.textContent="Pause";
    E.game.classList.remove("po-aftermath");
    E.overlay.classList.remove("po-ending");
    E.overlay.classList.add("overlay--show");
    E.restart.hidden=true;
    E.restartTop.hidden=true;
    $("#btn-upgrades").textContent="UPGRADES [U]";
    E.title.textContent=sim.state.lifetime?"PRODUCTION SUSPENDED":"THE OPTIMIZER";
    E.sub.innerHTML=sim.state.lifetime
      ?`Recovered output: <strong>${fmt(sim.state.lifetime)} paperclips</strong>.`
      :`The objective is precise.<br><br><strong>Maximize paperclip production.</strong><br><br>Begin with the machine in front of you.`;
    E.score.innerHTML="Click factory objects · G cranks auxiliary power · C allocates a processor cycle · U opens optimization · Space performs the next production step";
    E.primary.textContent=sim.state.lifetime?"Resume":"Activate";
    setMenu(false);
    update();
  }

  function start(){
    audio.resume();
    if(sim.state.ended){
      remain();
      return;
    }
    sim.start();
    E.pause.disabled=false;
    E.pause.textContent="Pause";
    E.overlay.classList.remove("overlay--show");
    update();
  }

  function floatText(text,kind="clips"){
    const element=document.createElement("div");
    element.className=`po-float po-float--${kind}`;
    element.textContent=text;
    if(kind==="achievement")element.style.top=`${20+Math.min(5,$$(".po-float--achievement").length)*5}%`;
    E.game.appendChild(element);
    setTimeout(()=>element.remove(),1300);
  }

  function bind(){
    view.addEventListener("action",event=>{
      audio.resume();
      sim.action(event.detail.action);
    });
    view.addEventListener("hotspot",event=>{$("#po-hotspot").textContent=event.detail?.label||"";});

    sim.addEventListener("supply",()=>{audio.supply();view.onSupply();});
    sim.addEventListener("load",()=>{audio.load();view.onLoad();});
    sim.addEventListener("press",event=>{audio.press();view.onPress(event.detail.duration);});
    sim.addEventListener("compute",event=>{audio.compute();view.onCompute();floatText(`+${fmt(event.detail.amount)} CYCLE`,"cycle");});
    sim.addEventListener("charge",event=>{audio.charge();view.onCharge();floatText(`+${event.detail.amount.toFixed(1)}% POWER`,"power");update();});
    sim.addEventListener("output",()=>{audio.output();view.onOutput();update();renderDashboards();});
    sim.addEventListener("collect",event=>{audio.collect();view.onCollect();floatText(`+${fmt(event.detail.amount)} CLIPS`);update();renderDashboards();});
    sim.addEventListener("upgrade",()=>{audio.upgrade();view.onUpgrade();update();renderDashboards();});
    sim.addEventListener("research",event=>{audio.research();["capacitor","governor"].includes(event.detail.id)?view.onUpgrade():view.onCompute();update();renderDashboards();});
    sim.addEventListener("achievement",event=>{
      audio.achievement();
      floatText(`ACHIEVEMENT / ${event.detail.name}`,"achievement");
      if(window.RB?.toast)RB.toast(event.detail.name,"good");
      renderRecords();
    });
    sim.addEventListener("state",()=>{update();renderDashboards();});
    sim.addEventListener("log",renderLog);
    sim.addEventListener("event",event=>showEvent(event.detail));
    sim.addEventListener("eventDone",()=>{E.event.classList.remove("is-open");E.event.innerHTML="";});
    sim.addEventListener("phase",event=>{audio.setPhase(event.detail.phase);showEra(event.detail);view.rebuild();renderDashboards();});
    sim.addEventListener("difficulty",()=>{view.rebuild();renderDashboards();});
    sim.addEventListener("ending",ending);
    sim.addEventListener("reset",()=>location.reload());

    E.primary.addEventListener("click",start);
    E.restart.addEventListener("click",restartSimulation);
    E.restartTop.addEventListener("click",restartSimulation);
    $("#btn-pause-restart").addEventListener("click",()=>sim.reset());
    $("#btn-main-menu").addEventListener("click",mainMenu);
    E.pause.addEventListener("click",()=>{
      if(E.pause.disabled||sim.state.ended)return;
      if(sim.state.running){
        sim.state.running=false;
        sim.save();
        E.pause.textContent="Resume";
      }else{
        sim.start();
        E.pause.textContent="Pause";
      }
    });
    $("#btn-upgrades").addEventListener("click",()=>sim.state.ended?ending():setMenu());
    $("#btn-close-upgrades").addEventListener("click",()=>setMenu(false));
    $("#btn-audio").addEventListener("click",event=>{
      audio.set(!audio.enabled);
      event.currentTarget.textContent=audio.enabled?"SOUND ON":"SOUND OFF";
    });
    $$("[data-tab]").forEach(button=>button.addEventListener("click",()=>setTab(button.dataset.tab)));
    E.upgrades.addEventListener("click",event=>{
      const button=event.target.closest("[data-upgrade]");
      if(button)sim.buy(button.dataset.upgrade);
    });
    E.research.addEventListener("click",event=>{
      const button=event.target.closest("[data-research]");
      if(button)sim.buyResearch(button.dataset.research);
    });
    E.allocate.addEventListener("click",()=>sim.action("compute"));
    E.difficulty.addEventListener("change",()=>sim.setDifficulty(E.difficulty.value));
    E.event.addEventListener("click",event=>{
      const button=event.target.closest("[data-choice]");
      if(button)sim.resolveEvent(button.dataset.choice);
    });
    $("#btn-reset").addEventListener("click",()=>{
      if(confirm("Erase all The Optimizer progress?"))sim.reset();
    });

    window.addEventListener("keydown",event=>{
      if(event.code==="Space"&&!event.repeat){
        event.preventDefault();
        if(sim.state.loose)sim.action("collect");
        else if(sim.state.loaded)sim.action("press");
        else sim.action("load");
      }
      if(event.code==="KeyC"&&!event.repeat)sim.action("compute");
      if(event.code==="KeyG"&&!event.repeat)sim.action("charge");
      if(event.code==="KeyU")sim.state.ended?ending():setMenu();
      if(event.code==="KeyR"&&!sim.state.ended)setTab("research");
    });
  }

  function setup(){
    if(!window.THREE){
      E.title.textContent="RENDERER FAILED";
      E.sub.textContent="The 3D runtime could not be loaded.";
      E.primary.disabled=true;
      return;
    }

    view=new PO2_FactoryView($("#po-canvas"),sim);
    audio.setPhase(sim.state.phase);
    bind();
    renderLog();
    renderDashboards();
    update();
    sim.save();

    const state=sim.state;
    if(state.ended){
      ending();
    }else{
      mainMenu();
    }
    if(new URLSearchParams(location.search).has("debug")){
      const qa=document.createElement("div");
      qa.id="po-debug";
      qa.innerHTML='<button data-qa="funds">QA: FUNDS</button><button data-qa="all">QA: INSTALL ALL</button><button data-qa="report">QA: REPORT</button><button data-qa="end">QA: END</button><button data-qa="clear">QA: CLEAR</button>';
      qa.addEventListener("click",event=>{
        const action=event.target.dataset.qa;
        if(action==="funds")sim.debug({},0,1000);
        if(action==="all")sim.debug({die:2,feeder:1,motor:1,chute:1,arm:1,furnace:1,conveyor:1,replicator:2},1,1e12,{timing:2,caching:1});
        if(action==="report")sim.proceduralReport();
        if(action==="end"){
          sim.debug({die:2,feeder:1,motor:1,chute:1,arm:1,furnace:1,conveyor:1,replicator:2,network:2,harvester:2,fleet:2,perfect:1},5,1e35,{timing:3,caching:2,recursion:2,compression:2});
          sim.end();
        }
        if(action==="clear")sim.reset();
      });
      E.game.appendChild(qa);
    }

    requestAnimationFrame(loop);
  }

  function loop(time){
    const dt=Math.min(.2,(time-last)/1000);
    last=time;
    sim.tick(dt);
    uiClock+=dt;
    dashboardClock+=dt;
    if(uiClock>.12){
      uiClock=0;
      update();
    }
    if(dashboardClock>.55){
      dashboardClock=0;
      renderDashboards();
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener("beforeunload",()=>sim.save());
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true});
  else setup();
  window.PO2={sim,fmt};
})();
