/* Names and equipment identify distinct lifts. Aliases are used only for search. */
(() => {
  const equipment = {
    B: 'Barbell',
    D: 'Dumbbell',
    C: 'Cable',
    M: 'Machine',
    W: 'Bodyweight',
    K: 'Kettlebell',
    S: 'Smith machine',
    R: 'Resistance band',
    T: 'Trap bar',
    E: 'EZ bar',
  };
  const catalog = `
#Chest|Triceps,Shoulders
B bench-press|Bench press|Flat bench,Barbell bench press
B incline-barbell-bench-press|Incline Barbell Bench Press|Incline bench
B decline-barbell-bench-press|Decline Barbell Bench Press
B close-grip-bench-press|Close-Grip Bench Press|CGBP
B larsen-press|Larsen Press
B paused-bench-press|Paused Bench Press
B spoto-press|Spoto Press
B barbell-floor-press|Barbell Floor Press
D dumbbell-bench-press|Dumbbell Bench Press|Flat dumbbell press,DB bench
D incline-dumbbell-press|Incline Dumbbell Press|Incline DB bench
D decline-dumbbell-press|Decline Dumbbell Press
D dumbbell-floor-press|Dumbbell Floor Press
D neutral-grip-dumbbell-press|Neutral-Grip Dumbbell Press
D dumbbell-squeeze-press|Dumbbell Squeeze Press
M machine-chest-press|Machine Chest Press|Seated chest press
M incline-machine-press|Incline Machine Press
M hammer-strength-chest-press|Hammer Strength Chest Press
S smith-machine-bench-press|Smith Machine Bench Press
S smith-machine-incline-press|Smith Machine Incline Press
W push-up|Push-Up|Press-up
W decline-push-up|Decline Push-Up|Feet-elevated push-up
W incline-push-up|Incline Push-Up
W weighted-push-up|Weighted Push-Up
W chest-dip|Chest Dip|Parallel bar dip
W weighted-dip|Weighted Dip|Weighted dips
#Chest|Shoulders|isolation
D dumbbell-fly|Dumbbell Fly|Flat fly
D incline-dumbbell-fly|Incline Dumbbell Fly
C cable-fly|Cable Fly|Cable crossover
C low-to-high-cable-fly|Low-to-High Cable Fly
C high-to-low-cable-fly|High-to-Low Cable Fly
C single-arm-cable-fly|Single-Arm Cable Fly
M pec-deck|Pec Deck|Machine fly
R band-chest-fly|Band Chest Fly
#Back|Biceps,Forearms
B barbell-row|Barbell Row|Bent-over row
B pendlay-row|Pendlay Row
B yates-row|Yates Row|Underhand barbell row
B meadows-row|Meadows Row|Landmine row
B t-bar-row|T-Bar Row
D one-arm-dumbbell-row|One-Arm Dumbbell Row|Single-arm DB row
D chest-supported-row|Chest-Supported Row|Incline dumbbell row
D dumbbell-seal-row|Dumbbell Seal Row
D renegade-row|Renegade Row
C seated-cable-row|Seated Cable Row|Low cable row
C wide-grip-cable-row|Wide-Grip Cable Row
C single-arm-cable-row|Single-Arm Cable Row
C lat-pulldown|Lat Pulldown|Lat pull-down
C close-grip-lat-pulldown|Close-Grip Lat Pulldown
C reverse-grip-lat-pulldown|Reverse-Grip Lat Pulldown
C single-arm-lat-pulldown|Single-Arm Lat Pulldown
C wide-grip-lat-pulldown|Wide-Grip Lat Pulldown
M chest-supported-machine-row|Chest-Supported Machine Row
M high-row-machine|High Row Machine
M iso-lateral-row|Iso-Lateral Row
M assisted-pull-up|Assisted Pull-Up
M assisted-chin-up|Assisted Chin-Up
W pull-up|Pull-Up|Overhand pullup
W chin-up|Chin-Up|Underhand pullup
W neutral-grip-pull-up|Neutral-Grip Pull-Up
W weighted-pull-up|Weighted Pull-Up
W weighted-chin-up|Weighted Chin-Up
W inverted-row|Inverted Row|Australian pull-up
W ring-row|Ring Row
R band-lat-pulldown|Band Lat Pulldown
R band-row|Band Row
K kettlebell-row|Kettlebell Row
#Back|Shoulders|isolation
C straight-arm-pulldown|Straight-Arm Pulldown|Cable pullover
D dumbbell-pullover|Dumbbell Pullover
M machine-pullover|Machine Pullover
#Shoulders|Triceps,Chest
B overhead-press|Overhead Press|Military press,Standing barbell press
B seated-barbell-shoulder-press|Seated Barbell Shoulder Press
B push-press|Push Press
B landmine-press|Landmine Press
D shoulder-press|Shoulder Press|Dumbbell shoulder press
D arnold-press|Arnold Press
D single-arm-dumbbell-overhead-press|Single-Arm Dumbbell Overhead Press
M machine-shoulder-press|Machine Shoulder Press
S smith-machine-shoulder-press|Smith Machine Shoulder Press
K kettlebell-press|Kettlebell Press
K single-arm-kettlebell-push-press|Single-Arm Kettlebell Push Press
W pike-push-up|Pike Push-Up
W handstand-push-up|Handstand Push-Up
#Shoulders|Upper back|isolation
D lateral-raise|Lateral Raise|Dumbbell lateral raise,Side raise
D leaning-dumbbell-lateral-raise|Leaning Dumbbell Lateral Raise
C cable-lateral-raise|Cable Lateral Raise
M machine-lateral-raise|Machine Lateral Raise
D front-raise|Front Raise|Dumbbell front raise
C cable-front-raise|Cable Front Raise
D rear-delt-fly|Rear Delt Fly|Reverse dumbbell fly
C cable-reverse-fly|Cable Reverse Fly
M reverse-pec-deck|Reverse Pec Deck|Rear delt machine
C face-pull|Face Pull|Rope face pull
D dumbbell-y-raise|Dumbbell Y-Raise
C cable-y-raise|Cable Y-Raise
R band-pull-apart|Band Pull-Apart
R band-external-rotation|Band External Rotation
C cable-external-rotation|Cable External Rotation
#Traps|Forearms,Upper back|isolation
B barbell-shrug|Barbell Shrug
D dumbbell-shrug|Dumbbell Shrug
C cable-shrug|Cable Shrug
T trap-bar-shrug|Trap Bar Shrug
B barbell-upright-row|Barbell Upright Row
C cable-upright-row|Cable Upright Row
#Biceps|Forearms|isolation
B barbell-curl|Barbell Curl|Straight bar curl
E ez-bar-curl|EZ-Bar Curl
D dumbbell-curl|Dumbbell Curl|DB curl
D alternating-dumbbell-curl|Alternating Dumbbell Curl
D incline-dumbbell-curl|Incline Dumbbell Curl
D hammer-curl|Hammer Curl|Neutral-grip curl
D cross-body-hammer-curl|Cross-Body Hammer Curl
D concentration-curl|Concentration Curl
D dumbbell-preacher-curl|Dumbbell Preacher Curl
E ez-bar-preacher-curl|EZ-Bar Preacher Curl
M machine-preacher-curl|Machine Preacher Curl
C cable-curl|Cable Curl
C bayesian-cable-curl|Bayesian Cable Curl
C rope-hammer-curl|Rope Hammer Curl
C high-cable-curl|High Cable Curl
D spider-curl|Spider Curl
E reverse-ez-bar-curl|Reverse EZ-Bar Curl
R band-curl|Band Curl
#Triceps|Forearms|isolation
C triceps-pushdown|Triceps Pushdown|Pressdown,Cable pushdown
C rope-pushdown|Rope Pushdown
C reverse-grip-pushdown|Reverse-Grip Pushdown
C single-arm-triceps-pushdown|Single-Arm Triceps Pushdown
C overhead-cable-triceps-extension|Overhead Cable Triceps Extension
D overhead-dumbbell-triceps-extension|Overhead Dumbbell Triceps Extension
D single-arm-overhead-dumbbell-extension|Single-Arm Overhead Dumbbell Extension
D dumbbell-skull-crusher|Dumbbell Skull Crusher
E ez-bar-skull-crusher|EZ-Bar Skull Crusher|Lying triceps extension
B barbell-skull-crusher|Barbell Skull Crusher
D dumbbell-kickback|Dumbbell Kickback
C cable-kickback|Cable Kickback
M triceps-extension-machine|Triceps Extension Machine
R band-triceps-pushdown|Band Triceps Pushdown
#Triceps|Chest,Shoulders
W bench-dip|Bench Dip
W triceps-dip|Triceps Dip
W diamond-push-up|Diamond Push-Up
M assisted-dip|Assisted Dip
#Quads|Glutes,Adductors
B barbell-back-squat|Barbell Back Squat|Back squat
B high-bar-back-squat|High-Bar Back Squat
B low-bar-back-squat|Low-Bar Back Squat
B front-squat|Front Squat
B pause-squat|Pause Squat
B box-squat|Box Squat
B zercher-squat|Zercher Squat
B barbell-split-squat|Barbell Split Squat
B barbell-reverse-lunge|Barbell Reverse Lunge
D goblet-squat|Goblet Squat|DB goblet squat
D dumbbell-bulgarian-split-squat|Dumbbell Bulgarian Split Squat|Rear-foot-elevated split squat
D dumbbell-walking-lunge|Dumbbell Walking Lunge
D dumbbell-reverse-lunge|Dumbbell Reverse Lunge
D dumbbell-step-up|Dumbbell Step-Up
D dumbbell-lateral-lunge|Dumbbell Lateral Lunge
K kettlebell-goblet-squat|Kettlebell Goblet Squat
K double-kettlebell-front-squat|Double Kettlebell Front Squat
M leg-press|Leg Press|Sled leg press
M single-leg-press|Single-Leg Press
M hack-squat|Hack Squat
M pendulum-squat|Pendulum Squat
M belt-squat|Belt Squat
M horizontal-leg-press|Horizontal Leg Press
S smith-machine-squat|Smith Machine Squat
S smith-machine-split-squat|Smith Machine Split Squat
W bodyweight-squat|Bodyweight Squat|Air squat
W pistol-squat|Pistol Squat
W sissy-squat|Sissy Squat
W wall-sit|Wall Sit
W bodyweight-reverse-lunge|Bodyweight Reverse Lunge
#Quads||isolation
M leg-extension|Leg Extension|Knee extension
M single-leg-extension|Single-Leg Extension
#Hamstrings|Glutes,Lower back
B romanian-deadlift|Romanian Deadlift|RDL
B stiff-leg-deadlift|Stiff-Leg Deadlift
B good-morning|Good Morning
D dumbbell-romanian-deadlift|Dumbbell Romanian Deadlift|DB RDL
D single-leg-dumbbell-romanian-deadlift|Single-Leg Dumbbell Romanian Deadlift
K kettlebell-romanian-deadlift|Kettlebell Romanian Deadlift
#Hamstrings|Calves|isolation
M leg-curl|Leg Curl|Hamstring curl
M seated-leg-curl|Seated Leg Curl
M lying-leg-curl|Lying Leg Curl|Prone leg curl
M standing-leg-curl|Standing Leg Curl
W nordic-curl|Nordic Curl|Nordic hamstring curl
W sliding-leg-curl|Sliding Leg Curl
M glute-ham-raise|Glute-Ham Raise|GHR
#Glutes|Hamstrings,Lower back
B conventional-deadlift|Conventional Deadlift|Barbell deadlift
B sumo-deadlift|Sumo Deadlift
B deficit-deadlift|Deficit Deadlift
B rack-pull|Rack Pull
T trap-bar-deadlift|Trap Bar Deadlift|Hex bar deadlift
K kettlebell-deadlift|Kettlebell Deadlift
K kettlebell-swing|Kettlebell Swing
B hip-thrust|Hip Thrust|Barbell hip thrust
B barbell-glute-bridge|Barbell Glute Bridge
M machine-hip-thrust|Machine Hip Thrust
S smith-machine-hip-thrust|Smith Machine Hip Thrust
W glute-bridge|Glute Bridge
W single-leg-glute-bridge|Single-Leg Glute Bridge
W single-leg-hip-thrust|Single-Leg Hip Thrust
C cable-pull-through|Cable Pull-Through
W 45-degree-back-extension|45-Degree Back Extension|Hyperextension
M reverse-hyperextension|Reverse Hyperextension
#Glutes|Abductors|isolation
M hip-abduction-machine|Hip Abduction Machine
C cable-hip-abduction|Cable Hip Abduction
R banded-lateral-walk|Banded Lateral Walk|Monster walk
W side-lying-hip-abduction|Side-Lying Hip Abduction
C cable-glute-kickback|Cable Glute Kickback
M glute-kickback-machine|Glute Kickback Machine
#Adductors|Core|isolation
M hip-adduction-machine|Hip Adduction Machine
C cable-hip-adduction|Cable Hip Adduction
W copenhagen-plank|Copenhagen Plank
#Calves||isolation
M calf-raise|Calf Raise|Standing machine calf raise
M seated-calf-raise|Seated Calf Raise
M leg-press-calf-raise|Leg Press Calf Raise
M donkey-calf-raise|Donkey Calf Raise
S smith-machine-calf-raise|Smith Machine Calf Raise
D dumbbell-standing-calf-raise|Dumbbell Standing Calf Raise
W single-leg-calf-raise|Single-Leg Calf Raise
W tibialis-raise|Tibialis Raise
#Core|Hip flexors|isolation
W crunch|Crunch
W reverse-crunch|Reverse Crunch
W sit-up|Sit-Up
W hanging-leg-raise|Hanging Leg Raise
W hanging-knee-raise|Hanging Knee Raise
W captain-s-chair-knee-raise|Captain's Chair Knee Raise
W lying-leg-raise|Lying Leg Raise
W hollow-body-hold|Hollow Body Hold
W dead-bug|Dead Bug
W plank|Plank|Front plank
W side-plank|Side Plank
W bird-dog|Bird Dog
W bicycle-crunch|Bicycle Crunch
W v-up|V-Up
W mountain-climber|Mountain Climber
W ab-wheel-rollout|Ab Wheel Rollout|Ab rollout
C cable-crunch|Cable Crunch
C pallof-press|Pallof Press|Anti-rotation press
C cable-wood-chop|Cable Wood Chop|Cable chop
M abdominal-crunch-machine|Abdominal Crunch Machine
D dumbbell-side-bend|Dumbbell Side Bend
K kettlebell-windmill|Kettlebell Windmill
#Forearms|Core|isolation
D dumbbell-wrist-curl|Dumbbell Wrist Curl
D reverse-dumbbell-wrist-curl|Reverse Dumbbell Wrist Curl
B barbell-wrist-curl|Barbell Wrist Curl
D farmer-s-carry|Farmer's Carry|Farmer walk
K kettlebell-suitcase-carry|Kettlebell Suitcase Carry
T trap-bar-carry|Trap Bar Carry
W dead-hang|Dead Hang
#Full body|Traps,Quads,Glutes
B power-clean|Power Clean
B hang-power-clean|Hang Power Clean
B clean-and-jerk|Clean and Jerk
B power-snatch|Power Snatch
B hang-power-snatch|Hang Power Snatch
B barbell-thruster|Barbell Thruster
D dumbbell-thruster|Dumbbell Thruster
D dumbbell-snatch|Dumbbell Snatch
K kettlebell-clean|Kettlebell Clean
K kettlebell-snatch|Kettlebell Snatch
K turkish-get-up|Turkish Get-Up
`;
  const searchNames = {
    B: 'barbell',
    D: 'DB',
    C: 'cable',
    M: 'machine',
    W: 'bodyweight',
    K: 'KB',
    S: 'Smith',
    R: 'band',
    T: 'hex bar',
    E: 'EZ',
  };
  let muscle, secondary, isolation;
  const exercises = [];
  for (const line of catalog.trim().split('\n')) {
    if (line.startsWith('#')) {
      [muscle, secondary, isolation] = line.slice(1).split('|');
      continue;
    }
    const type = line[0];
    const [id, name, aliases = ''] = line.slice(2).split('|');
    const heavy = /squat|deadlift|clean|snatch/i.test(name) && !isolation;
    const defaults = {
      count: 3,
      lo: isolation ? 10 : heavy ? 5 : 6,
      hi: isolation ? 15 : heavy ? 8 : 10,
      rest: isolation ? 90 : heavy ? 180 : 120,
      step: ['B', 'T', 'S', 'M'].includes(type) ? 5 : 2.5,
    };
    if (name === 'Bench press') Object.assign(defaults, { lo: 4, hi: 6, rest: 180 });
    if (/plank|hold|dead hang|wall sit/i.test(name)) {
      Object.assign(defaults, { lo: 1, hi: 1, rest: 60, instructions: 'Log one controlled 15–30 second hold as one rep.' });
    } else if (/carry/i.test(name)) {
      Object.assign(defaults, { lo: 1, hi: 1, rest: 90, instructions: 'Log one 20–40 meter carry as one rep.' });
    }
    exercises.push({
      id: 'lift-' + id,
      name,
      aliases: aliases
        ? aliases.split(',')
        : [
            searchNames[type] +
              ' ' +
              name.replace(
                /^(barbell|dumbbell|cable|machine|bodyweight|kettlebell|smith machine|band|trap bar|ez-bar) /i,
                '',
              ),
          ],
      muscle,
      secondary: secondary.split(',').filter(Boolean),
      equipment: equipment[type],
      defaults,
    });
  }
  const api = { exercises, equipment: Object.values(equipment) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.ExerciseLibrary = api;
})();
