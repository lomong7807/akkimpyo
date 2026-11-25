// jsdom에는 없다. 배치를 계산하지 않으므로 아무것도 하지 않는다
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = () => {}
