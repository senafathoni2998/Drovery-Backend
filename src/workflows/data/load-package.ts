import { Workflow } from './index';

export const loadPackageWorkflow: Workflow = {
  id: 'load_package',
  title: 'Load Package',
  subtitle: 'Follow the steps to load your package to the drone',
  steps: [
    {
      id: 'prepare_drone',
      type: 'checklist',
      title: 'Prepare Drone',
      instruction:
        'Before proceeding, confirm that the drone meets all of the following conditions:',
      items: [
        { id: 'on_ground', label: 'Drone is on the ground' },
        { id: 'propeller_stopped', label: 'Propeller has completely stopped' },
        { id: 'led_yellow', label: 'Drone LED is showing yellow' },
      ],
      nextLabel: 'All Conditions Met',
    },
    {
      id: 'show_qr',
      type: 'qr_display',
      title: 'Show Your QR Code',
      instruction:
        'Hold your phone up to the drone camera. The drone will scan your QR code and open the storage box automatically.',
      hint: 'Keep the screen bright and steady for the drone camera to scan',
      nextLabel: 'Box is Open',
    },
    {
      id: 'scan_drone_qr',
      type: 'qr_scan',
      title: 'Scan Drone QR Code',
      instruction:
        'Scan the QR code displayed on the drone screen to confirm this is the correct drone for your delivery.',
      hint: 'Point your camera at the QR code shown on the drone display',
      nextLabel: "I've Scanned the QR",
    },
    {
      id: 'put_package',
      type: 'instruction',
      title: 'Put Package in Box',
      instruction:
        'Carefully place your package into the open drone box. Make sure it is properly secured inside before closing.',
      icon: 'cube-outline',
      iconColor: '#6366F1',
      nextLabel: 'Package is in the Box',
    },
    {
      id: 'press_button_verify',
      type: 'drone_button',
      title: 'Press Drone Button',
      instruction:
        'Press the physical button on the drone to confirm you have placed the package inside the storage box.',
      icon: 'radio-button-on',
      nextLabel: 'Button Pressed',
    },
    {
      id: 'check_led_green',
      type: 'status_check',
      title: 'Check Drone LED',
      instruction:
        'Check the drone LED indicator. A green LED means the package has been registered and the drone is ready for delivery.',
      indicator: {
        label: 'LED is Green',
        color: '#22C55E',
        description: 'Package registered — ready to deliver',
      },
      nextLabel: 'LED is Green',
    },
    {
      id: 'confirm_takeoff',
      type: 'drone_button',
      title: 'Confirm & Step Back',
      instruction:
        'Press the drone button one more time to confirm, then immediately step back at least 3 meters to give the drone a clear space to take off safely.',
      icon: 'walk-outline',
      nextLabel: 'Done',
    },
  ],
};
