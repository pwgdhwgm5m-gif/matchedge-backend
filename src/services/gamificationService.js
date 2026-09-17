const RANKS = [
  { min: 0, name: 'Çaylak', icon: '🌱' },
  { min: 100, name: 'Analist', icon: '📊' },
  { min: 300, name: 'Uzman', icon: '🎯' },
  { min: 700, name: 'Usta', icon: '🏆' },
  { min: 1500, name: 'Efsane', icon: '👑' },
];
function rankForXp(xp=0){ return [...RANKS].reverse().find(r=>xp>=r.min)||RANKS[0]; }
module.exports={RANKS,rankForXp};
