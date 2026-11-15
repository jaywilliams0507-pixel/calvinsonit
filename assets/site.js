/* CalvinsonIT site script. Every block checks its elements exist, so one file serves all pages. */

(function(){
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // routing: #audit is the service page; everything else is home

  // card spotlight
  document.querySelectorAll('.svc').forEach(function(c){
    c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px');});
  });

  // Calvin's eyes follow the pointer
  var bot=document.getElementById('bigbot'),pupils=document.getElementById('pupils');
  if(bot&&pupils&&!reduce){
    window.addEventListener('pointermove',function(e){
      var r=bot.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height*.42;
      var dx=Math.max(-1,Math.min(1,(e.clientX-cx)/400)),dy=Math.max(-1,Math.min(1,(e.clientY-cy)/400));
      pupils.setAttribute('transform','translate('+(dx*7).toFixed(1)+' '+(dy*5).toFixed(1)+')');
    });
  }

  // job console
  var jobs=[
    {t:"AI Answer Visibility Audit",s:"sample client: family HVAC company",r:"Report emailed to the owner",l:["Asked ChatGPT 25 questions customers really ask","Ran the same questions in Google AI","Found 9 answers that name competitors, not you","Ranked the fixes by impact"]},
    {t:"Google Business Profile Optimization",s:"sample client: dental practice",r:"Profile updated and verified",l:["Checked primary and secondary categories","Filled in every service and the service area","Matched hours and contact info everywhere","Listed the next 4 updates to post"]},
    {t:"Shopify Catalog & Feed Cleanup",s:"sample client: auto parts reseller · 1,847 parts",r:"Import file live in Shopify",l:["Merged 3 supplier spreadsheets","Removed 212 duplicate parts","Flagged 96 parts with missing prices","Matched titles to one clean format"]},
    {t:"Business Automation",s:"sample client: home cleaning service",r:"Runs on its own every day",l:["Connected the website form","New leads logged in one sheet","Replies sent in the owner's voice","Weekly summary sent to the owner"]}
  ];
  var tabs=[].slice.call(document.querySelectorAll('.tab')),list=document.getElementById('job-steps'),cur=0,timer=null;
  if(list){
  function show(i){
    cur=i;var j=jobs[i];
    tabs.forEach(function(b,k){b.setAttribute('aria-selected',k===i?'true':'false')});
    document.getElementById('job-title').textContent=j.t;
    document.getElementById('job-sub').textContent=j.s;
    document.getElementById('job-result').textContent=j.r;
    list.innerHTML=j.l.map(function(x){return '<li><svg aria-hidden="true"><use href="#tick"/></svg><span>'+x+'</span><span class="t">done</span></li>'}).join('');
    list.classList.remove('anim');void list.offsetWidth;if(!reduce)list.classList.add('anim');
  }
  tabs.forEach(function(b){b.addEventListener('click',function(){clearInterval(timer);show(+b.dataset.i)})});
  var paused=false,cons=document.querySelector('.console');
  if(cons){['mouseenter','focusin'].forEach(function(e){cons.addEventListener(e,function(){paused=true})});['mouseleave','focusout'].forEach(function(e){cons.addEventListener(e,function(){paused=false})});}
  if(!reduce)timer=setInterval(function(){if(!paused)show((cur+1)%jobs.length)},6000);

  }
  // quiz preview options
  document.querySelectorAll('#quiz-opts .opt').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('#quiz-opts .opt').forEach(function(x){x.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true');});});
})();
