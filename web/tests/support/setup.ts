import { installDialog } from './dialog'

// jsdom에는 없다. 배치를 계산하지 않고 움직임이 없으므로 아무것도 하지 않는다
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.getAnimations = () => []
  installDialog()
}
