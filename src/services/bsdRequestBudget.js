const utcDay = (now) => new Date(now).toISOString().slice(0,10);

class BsdRequestBudget {
  constructor({dailyBudget=6000,remainingReserve=400,now=()=>Date.now()}={}) {
    this.dailyBudget=dailyBudget;
    this.remainingReserve=remainingReserve;
    this.now=now;
    this.day=utcDay(now());
    this.requests=0;
    this.remaining=null;
    this.cooldownUntil=0;
  }

  reserve() {
    const now=this.now(),day=utcDay(now);
    if(day!==this.day){this.day=day;this.requests=0;this.remaining=null;this.cooldownUntil=0;}
    if(now<this.cooldownUntil || this.requests>=this.dailyBudget ||
      (this.remaining!==null && this.remaining<=this.remainingReserve))return false;
    this.requests++;
    if(this.remaining!==null)this.remaining--;
    return true;
  }

  observe(response) {
    const header=response.headers?.get('ratelimit')||'';
    // BSD's documented football header: `"football";r=7213;t=52800`.
    const scope=header.match(/(?:^|,)\s*"football"\s*;([^,]*)/i);
    const remaining=scope?.[1].match(/(?:^|;)\s*r=(\d+)(?:;|$)/i);
    if(remaining)this.remaining=Math.min(this.remaining??Infinity,Number(remaining[1]));
    if(response.status===429){
      const seconds=Number(response.headers?.get('retry-after'));
      this.cooldownUntil=this.now()+Math.max(1,Number.isFinite(seconds)?seconds:60)*1000;
    }
  }
}

module.exports={BsdRequestBudget};
