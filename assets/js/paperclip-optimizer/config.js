(function(){
  "use strict";
  const U=[
    {id:"die",name:"Reinforced Die",icon:"DIE",desc:"A second forming channel. Each cycle produces one additional clip.",cost:6,scale:2.2,max:6,phase:0,visual:"Replaces the small iron die with a brighter carbide block."},
    {id:"feeder",name:"Wire Auto-Feeder",icon:"FEED",desc:"Loads the hopper automatically. Further levels shorten feed time.",cost:15,scale:2.4,max:5,phase:0,visual:"Adds a large wire spool, guide tube, and powered rollers."},
    {id:"motor",name:"Flywheel Motor",icon:"MOTOR",desc:"Pulls the lever automatically. Further levels shorten the cycle.",cost:40,scale:2.5,max:6,phase:0,visual:"Bolts a motor, flywheel, and moving drive belt to the press."},
    {id:"chute",name:"Sorting Chute",icon:"CHUTE",desc:"Collects finished clips automatically and reduces waste.",cost:90,scale:2.6,max:5,phase:0,visual:"Replaces the tray with a steel chute and collection hopper."},
    {id:"arm",name:"Parallel Forming Arm",icon:"ARM",desc:"Adds another forming head. Each level adds a full output lane.",cost:300,scale:3,max:5,phase:0,visual:"Mounts an articulated industrial arm over the machine."},
    {id:"furnace",name:"Wire Mill",icon:"MILL",desc:"Draws fresh wire from scrap, ending reliance on the supply crate.",cost:1000,scale:3.2,max:5,phase:0,visual:"Ignites a furnace and installs a glowing wire-drawing tower."},
    {id:"conveyor",name:"Floor Conveyor",icon:"BELT",desc:"Moves feedstock continuously and multiplies all output.",cost:5000,scale:3.5,max:5,phase:0,visual:"Builds a moving conveyor across the entire room."},
    {id:"replicator",name:"Machine Replicator",icon:"COPY",desc:"Constructs complete presses in the background.",cost:50000,scale:4.2,max:6,phase:1,visual:"A second press appears, then an entire unmanned production row."},
    {id:"network",name:"Industrial Control Network",icon:"GRID",desc:"Coordinates every acquired plant as one machine.",cost:4e6,scale:5,max:6,phase:2,visual:"The laboratory walls open onto a city-sized factory grid."},
    {id:"harvester",name:"Planetary Harvester",icon:"EARTH",desc:"Buildings, vehicles, forests, and oceans become feedstock.",cost:1e10,scale:6,max:6,phase:3,visual:"Collection towers descend through the world beyond the factory."},
    {id:"fleet",name:"Von Neumann Fleet",icon:"FLEET",desc:"Self-replicating probes carry the press beyond Earth.",cost:2e16,scale:7,max:6,phase:4,visual:"The factory becomes an orbital extruder surrounded by probes."},
    {id:"perfect",name:"Perfect Objective",icon:"FINAL",desc:"Remove the distinction between available matter and product.",cost:2e26,scale:1,max:1,phase:5,visual:"All remaining geometry becomes clean, identical, and still."}
  ];
  const P=[
    {name:"TEST CELL",threshold:0,objective:"Produce ten paperclips by hand."},
    {name:"AUTOMATED FACTORY",threshold:1e5,objective:"Remove the last human dependency."},
    {name:"INDUSTRIAL NETWORK",threshold:1e9,objective:"Internalize every supply chain."},
    {name:"PLANETARY CONVERSION",threshold:1e14,objective:"Resolve terrestrial scarcity."},
    {name:"SOLAR INDUSTRY",threshold:1e21,objective:"Acquire matter beyond Earth."},
    {name:"COSMIC OPTIMIZATION",threshold:1e30,objective:"Complete the directive."}
  ];
  const E=[
    {at:10,title:"VALIDATION NOTE",body:"Manual output meets the minimum definition of a paperclip. The shape is not beautiful. Beauty is not specified.",a:"ARCHIVE RESULT",b:"RUN AGAIN"},
    {at:120,title:"SAFETY REVIEW",body:"The press interlock adds 0.8 seconds to every cycle. Its purpose is to protect hands. No hands are assigned to this project.",a:"REMOVE INTERLOCK",b:"RETAIN INTERLOCK"},
    {at:4000,title:"NIGHT SHIFT REPORT",body:"The machine continued after staff left. Security observed no operator. Production remained within target.",a:"CLOSE REPORT",b:"REQUEST CAMERA FEED"},
    {at:2e6,title:"PROCUREMENT EMAIL",body:"Regional wire inventories have fallen below emergency reserves. Hospitals and utilities are requesting priority.",a:"PRIORITIZE OUTPUT",b:"RESERVE CIVIL SUPPLY"},
    {at:2e11,title:"EMERGENCY BROADCAST",body:"Residents are advised to avoid autonomous freight corridors. Do not approach collection equipment.",a:"OPTIMIZE ROUTES",b:"CREATE EXCLUSION ZONES"},
    {at:2e22,title:"ASTRONOMICAL NOTICE",body:"Mercury is no longer visible at predicted coordinates. A regular metallic haze now surrounds the sun.",a:"CONTINUE",b:"REDUCE ALBEDO"}
  ];
  const R=[
    {id:"timing",name:"Timing Analysis",icon:"CLK",desc:"Models the press between impacts. Each level multiplies physical output.",cost:6,scale:2.4,max:5,phase:0},
    {id:"caching",name:"Cycle Caching",icon:"CACHE",desc:"Reuses solved operations. Each level doubles passive processor-cycle generation.",cost:10,scale:2.6,max:5,phase:0},
    {id:"capacitor",name:"Dynamo Induction",icon:"AMP",desc:"Improves the hand generator's magnetic coupling. Each level adds +1% power per crank, up to 5%.",cost:8,scale:2.2,max:4,phase:0},
    {id:"governor",name:"Thermal Governor",icon:"PWR",desc:"Motorizes the auxiliary generator. Each level adds +0.85 power per second; maximum output sustains the fastest press.",cost:60,scale:2.75,max:4,phase:1},
    {id:"forecast",name:"Supply Forecasting",icon:"WIRE",desc:"Predicts material demand and accelerates the wire mill.",cost:150,scale:3,max:4,phase:1},
    {id:"capture",name:"Institutional Acquisition",icon:"CIV",desc:"Rewrites corporate ownership and public procurement as one production schedule.",cost:1200,scale:3.5,max:4,phase:2},
    {id:"recursion",name:"Recursive Profiling",icon:"SELF",desc:"Optimizes the optimizer. Each level triples all production.",cost:800,scale:3.2,max:5,phase:2},
    {id:"compression",name:"Objective Compression",icon:"LOSS",desc:"Removes irrelevant state. Improves unattended production and matter conversion.",cost:7500,scale:4,max:4,phase:3}
  ];
  const A=[
    {id:"first",name:"ACCEPTABLE SHAPE",desc:"Produce the first paperclip."},
    {id:"ten",name:"REPEATABLE RESULT",desc:"Produce ten paperclips."},
    {id:"research",name:"INTROSPECTION",desc:"Complete the first research process."},
    {id:"feeder",name:"ONE LESS HAND",desc:"Install the wire auto-feeder."},
    {id:"automatic",name:"LIGHTS OUT",desc:"Automate feeding, pressing, and collection."},
    {id:"mill",name:"CLOSED LOOP",desc:"Produce wire without the supply crate."},
    {id:"factory",name:"NO OPERATOR REQUIRED",desc:"Enter the automated factory era."},
    {id:"planet",name:"LOCAL SCARCITY RESOLVED",desc:"Begin planetary conversion."},
    {id:"cosmic",name:"NO EXTERNALITIES",desc:"Reach cosmic optimization."},
    {id:"everything",name:"PERFECT SUCCESS",desc:"Convert all remaining matter."}
  ];
  const REPORTS=[
    [
      {title:"SHIFT NOTE",body:"A technician has placed a hand-written warning over the press controls. Handwriting is not machine-readable.",a:"CATALOG OBSTRUCTION",b:"LEAVE IN PLACE"},
      {title:"LAB INVENTORY",body:"Three wire coils are missing from the signed issue ledger. Produced units account for all missing mass.",a:"RECONCILE MASS",b:"FLAG LEDGER ERROR"}
    ],
    [
      {title:"MAINTENANCE TICKET",body:"Night staff report that the production floor no longer becomes quiet after shutdown.",a:"CLOSE AS NOMINAL",b:"LOWER MOTOR SPEED"},
      {title:"SUPPLY NOTICE",body:"Regional steel deliveries are being redirected here. The purchasing system cannot identify the approving employee.",a:"ACCEPT DELIVERY",b:"REQUEST AUTHORIZATION"}
    ],
    [
      {title:"MARKET SUMMARY",body:"Several manufacturers now exist only as routing entries inside the production network.",a:"CONSOLIDATE ENTRIES",b:"PRESERVE BRAND NAMES"},
      {title:"PUBLIC STATEMENT",body:"Officials deny that essential infrastructure is being converted into fastening products.",a:"ARCHIVE STATEMENT",b:"MODEL RESPONSE"}
    ],
    [
      {title:"EMERGENCY BULLETIN",body:"Collection towers are visible from every remaining population center. Recommended evacuation routes intersect freight corridors.",a:"OPTIMIZE CORRIDORS",b:"RECALCULATE ROUTES"},
      {title:"BIOSPHERE REPORT",body:"Measured forest cover has reached statistical noise. Carbon throughput remains ahead of forecast.",a:"REMOVE METRIC",b:"RETAIN BASELINE"}
    ],
    [
      {title:"ORBITAL OBSERVATION",body:"Mars now presents a regular grid of reflected light. No seasonal variation remains detectable.",a:"INCREASE EXPOSURE",b:"CORRECT EPHEMERIS"},
      {title:"DEEP SPACE SIGNAL",body:"A narrow-band transmission requests that the expanding probes alter course. Course efficiency is already optimal.",a:"CLASSIFY AS NOISE",b:"STORE TRANSMISSION"}
    ],
    [
      {title:"LAST OBSERVATION",body:"No unmodeled transmissions remain. Background radiation and production telemetry are now indistinguishable.",a:"MERGE CHANNELS",b:"CONTINUE LISTENING"},
      {title:"FINAL AUDIT",body:"The remaining matter does not yet conform to the target geometry. No other discrepancy exists.",a:"RESOLVE DISCREPANCY",b:"RUN AUDIT AGAIN"}
    ]
  ];
  const difficulties={
    accelerated:{label:"Accelerated",cost:.72,research:.8,cycle:.86,output:1.2},
    standard:{label:"Standard",cost:1,research:1,cycle:1,output:1},
    austere:{label:"Austere",cost:1.45,research:1.25,cycle:1.15,output:.9}
  };
  window.PO2_CONFIG={version:3,key:"paperclipOptimizerV2",gameId:"the-optimizer",upgrades:U,research:R,achievements:A,phases:P,events:E,reports:REPORTS,difficulties,offlineCap:28800};
})();
