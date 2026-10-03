 // Rich options keep the SSH status dot after the name in both the trigger and menu.
 function ComputerSelector({value,options,disabled,onChange}){
  const [expanded,setExpanded]=R.useState(false),[active,setActive]=R.useState(0),root=R.useRef(null),trigger=R.useRef(null),listId=R.useId();
  const selected=options.find(option=>option.id===value)||options[0];
  const close=()=>setExpanded(false);
  R.useEffect(()=>{if(disabled)close();},[disabled]);
  R.useEffect(()=>{
   if(!expanded)return;
   const outside=event=>{if(!root.current?.contains(event.target))close();};
   document.addEventListener('pointerdown',outside,true);
   return()=>document.removeEventListener('pointerdown',outside,true);
  },[expanded]);
  const show=()=>{setActive(Math.max(0,options.findIndex(option=>option.id===value)));setExpanded(true);};
  const choose=option=>{onChange(option.id);close();trigger.current?.focus();};
  const name=option=>h(R.Fragment,null,h('span',{className:'ssh-computer-name'},option.label),option.id!=='local'&&h('span',{className:'ssh-computer-status','data-state':option.state||'idle',role:'img','aria-label':'SSH · '+(STATUS_LABELS[option.state]||STATUS_LABELS.idle),title:'SSH · '+(STATUS_LABELS[option.state]||STATUS_LABELS.idle)}));
  return h('div',{className:'ssh-computer-select',ref:root,onBlur:event=>{if(!event.currentTarget.contains(event.relatedTarget))close();},onKeyDown:event=>{
   if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();close();return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopPropagation();
    if(!expanded){show();return;}
    setActive(index=>event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);
   }else if((event.key==='Enter'||event.key===' ')&&expanded){event.preventDefault();event.stopPropagation();choose(options[Math.min(active,options.length-1)]);}
  }},h('button',{ref:trigger,type:'button',role:'combobox','aria-label':'选择电脑','aria-expanded':expanded,'aria-haspopup':'listbox','aria-controls':expanded?listId:undefined,'aria-activedescendant':expanded?listId+'-'+active:undefined,'data-modal-autofocus':true,className:'ssh-computer-trigger',disabled,onClick:()=>expanded?close():show()},name(selected),h('svg',{width:12,height:12,viewBox:'0 0 12 12',fill:'none','aria-hidden':true},h('path',{d:'m3 4.5 3 3 3-3',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round'}))),
   expanded&&h('div',{id:listId,role:'listbox','aria-label':'电脑',className:'ssh-computer-options'},...options.map((option,index)=>h('div',{key:option.id,id:listId+'-'+index,role:'option','aria-label':option.label,'aria-selected':option.id===value,'data-active':index===active,className:'ssh-computer-option',onPointerDown:event=>event.preventDefault(),onPointerMove:()=>setActive(index),onClick:()=>choose(option)},name(option)))));
 }
